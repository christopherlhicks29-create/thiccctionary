#!/usr/bin/env node
/**
 * Wave 155: auto-retry failed office posts.
 *
 * Walks data/office-post-queue.json for posts with status='failed', classifies
 * the recorded error (schema problem, transient network, rate limit, terminal),
 * and retries the post via the same Buffer GraphQL call post-to-buffer.js uses.
 *
 * Retry rules:
 *   - Max 3 retries per post (counter on the post itself: retry_count)
 *   - SCHEMA error  -> retry (the bad param has likely been fixed in code)
 *   - TRANSIENT     -> retry (5xx, rate limit, network)
 *   - TERMINAL      -> mark errorClass='terminal' and stop retrying
 *   - >7 days old   -> stop retrying (don't resurrect ancient failures)
 *
 * Writes the queue back with updated status/retry_count/errors/posted_at.
 *
 * Required env:
 *   BUFFER_ACCESS_TOKEN  Buffer GraphQL bearer
 *   BUFFER_PROFILE_IDS   "service:channelId,service:channelId" - same as post-to-buffer.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data', 'office-post-queue.json');
const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILE_IDS = process.env.BUFFER_PROFILE_IDS;
if (!TOKEN || !PROFILE_IDS) {
  console.error('FATAL: BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS required');
  process.exit(1);
}

const MAX_RETRIES = 3;
const MAX_AGE_DAYS = 7;

function classify(errors) {
  // errors is the array we stored: [{ channelId, status, body }, ...]
  // Look at any one body for a hint - they usually share a cause.
  const blob = JSON.stringify(errors || []).toLowerCase();
  if (blob.includes('schedulingtype') || blob.includes('does not exist in')) return 'SCHEMA';
  if (blob.includes('rate limit') || blob.includes('429')) return 'TRANSIENT';
  if (blob.includes('5') && (blob.includes('status":5') || blob.includes('status": 5'))) return 'TRANSIENT';
  if (blob.includes('network') || blob.includes('timeout') || blob.includes('econnreset')) return 'TRANSIENT';
  if (blob.includes('channel not found') || blob.includes('account suspended') || blob.includes('unauthorized')) return 'TERMINAL';
  if (blob.includes('duplicate') || blob.includes('whoops')) return 'TERMINAL'; // Buffer's "posted that recently"
  return 'UNKNOWN';
}

function metadataForService(service) {
  if (service === 'twitter' || service === 'x') return undefined;
  if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'post' } };
  if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'post', shouldShareToFeed: true } };
  return undefined;
}

async function postOne({ channelId, text, service }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id text dueAt } }
        ... on MutationError { message }
      }
    }
  `;
  const input = { channelId, text, schedulingType: 'automatic', mode: 'addToQueue' };
  const meta = metadataForService(service);
  if (meta) input.metadata = meta;

  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, channelId, status: res.status, body: JSON.stringify(json).slice(0, 500) };
  if (json.errors && json.errors.length > 0) return { ok: false, channelId, status: 200, body: JSON.stringify(json.errors).slice(0, 500) };
  const r = json.data?.createPost;
  if (r?.__typename === 'MutationError' || r?.message) return { ok: false, channelId, status: 200, body: r.message || 'MutationError' };
  return { ok: true, channelId, postId: r?.post?.id };
}

function isOlderThan(iso, days) {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) > days * 24 * 3600 * 1000;
}

async function main() {
  const queue = JSON.parse(await fs.readFile(QUEUE_PATH, 'utf8'));
  const posts = Array.isArray(queue) ? queue : (queue.posts || []);

  const channels = PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const idx = s.indexOf(':');
    if (idx === -1) return { service: null, channelId: s };
    return { service: s.slice(0, idx).toLowerCase(), channelId: s.slice(idx + 1) };
  }).filter(c => c.service !== 'instagram'); // office posts are text-only -> skip IG

  const failed = posts.filter(p => p.status === 'failed');
  console.log(`[retry] found ${failed.length} failed post(s) in queue`);

  let retried = 0, recovered = 0, skipped = 0;
  for (const p of failed) {
    const tries = p.retry_count || 0;
    if (tries >= MAX_RETRIES) { console.log(`[retry] ${p.id}: hit retry cap (${tries}/${MAX_RETRIES}), skipping`); skipped++; continue; }
    if (isOlderThan(p.created, MAX_AGE_DAYS)) { console.log(`[retry] ${p.id}: older than ${MAX_AGE_DAYS}d, skipping`); skipped++; continue; }
    const klass = classify(p.errors);
    if (klass === 'TERMINAL') { console.log(`[retry] ${p.id}: TERMINAL error, marking and skipping`); p.errorClass = 'terminal'; skipped++; continue; }
    console.log(`[retry] ${p.id}: classified ${klass}, attempt ${tries + 1}/${MAX_RETRIES}`);

    const results = await Promise.all(channels.map(c => postOne({ channelId: c.channelId, text: p.text, service: c.service })));
    const successes = results.filter(r => r.ok).length;
    const failures = results.filter(r => !r.ok).length;
    p.retry_count = tries + 1;
    p.retried_at = new Date().toISOString();
    if (successes > 0 && failures === 0) {
      p.status = 'posted';
      p.posted_at = new Date().toISOString();
      p.success_count = successes;
      p.failure_count = 0;
      delete p.errors;
      console.log(`[retry] ${p.id}: RECOVERED (${successes}/${channels.length} channels)`);
      recovered++;
    } else {
      p.success_count = successes;
      p.failure_count = failures;
      p.errors = results.filter(r => !r.ok).map(r => ({ channelId: r.channelId, status: r.status, body: r.body }));
      console.log(`[retry] ${p.id}: still failing (${successes} ok, ${failures} fail)`);
    }
    retried++;
  }

  await fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
  console.log(`\n[retry] done. retried=${retried} recovered=${recovered} skipped=${skipped}`);
}

main().catch(e => { console.error('[retry] FATAL:', e); process.exit(1); });
