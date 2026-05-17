/**
 * Push hand-crafted employee social posts directly to Buffer.
 * Each post is curated for accessibility (strangers can parse it) + voice fit.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILES = (process.env.BUFFER_PROFILE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TOKEN || PROFILES.length === 0) { console.error('FATAL: missing Buffer creds'); process.exit(1); }

const BUFFER_API = 'https://api.buffer.com/';

// Channel IDs (strip service prefix)
const CHANNELS = PROFILES.map(p => {
  const i = p.indexOf(':');
  const svc = i >= 0 ? p.slice(0, i).toLowerCase() : null;
  const id = i >= 0 ? p.slice(i + 1) : p;
  return { service: svc, channelId: id };
}).filter(c => c.service !== 'instagram');  // skip IG (text-only)

const POSTS = [
  {
    byline: 'Eli',
    text: `Eleven fire hydrants on the walk to work this morning. Six blocks. One outside the deli has been repainted three times since January. Currently a confident cream.

Eliza`
  },
  {
    byline: 'Teddy',
    text: `Re: the ongoing question of whether the Saturn V counts. It does. Five F-1 engines, 7.5 million pounds of thrust, 363 feet of vehicle. Whatever the objection in 1969 was, the Saturn V outlived it.

Theodore`
  },
  {
    byline: 'Bart',
    text: `Today's formal objection: inflatable rafts. They are not thiccc. They are temporarily thiccc, which is a separate category. The catalogue, properly understood, distinguishes.

Bartholomew`
  },
  {
    byline: 'Margie',
    text: `Reporting in from Sonoma. Spent ninety minutes watching a tractor today, by my estimate one of the better tractors of its class. Will assign coverage when I return. Approximately.

Margaret`
  },
];

async function gql(query, variables = {}) {
  const res = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json.errors, status: res.status, data: json.data, errors: json.errors };
}

async function postOne(channelId, text, service) {
  const mutation = `mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id text dueAt } }
      ... on MutationError { message }
    }
  }`;
  const input = {
    channelId,
    text,
    schedulingType: 'automatic',
    mode: 'addToQueue',
  };
  if (service === 'facebook' || service === 'facebookpage') {
    input.metadata = { facebook: { type: 'post' } };
  } else if (service === 'instagram' || service === 'instagrambusiness') {
    input.metadata = { instagram: { type: 'post', shouldShareToFeed: true } };
  }
  const r = await gql(mutation, { input });
  if (!r.ok) return { ok: false, error: JSON.stringify(r.errors || r.status).slice(0, 200) };
  const result = r.data?.createPost;
  if (result?.message) return { ok: false, error: result.message };
  return { ok: true, postId: result?.post?.id };
}

async function main() {
  // Load + extend the office-post-queue
  const queuePath = path.join(ROOT, 'data', 'office-post-queue.json');
  let queue = [];
  try { queue = JSON.parse(await fs.readFile(queuePath, 'utf8')); } catch (e) { queue = []; }

  for (const draft of POSTS) {
    console.log(`\nPosting "${draft.byline}": ${draft.text.slice(0, 70)}...`);
    let success = 0, failure = 0;
    const errors = [];
    for (const ch of CHANNELS) {
      const r = await postOne(ch.channelId, draft.text, ch.service);
      if (r.ok) { success++; console.log(`  ${ch.service}: ok (${r.postId})`); }
      else { failure++; errors.push({ channelId: ch.channelId, service: ch.service, error: r.error }); console.log(`  ${ch.service}: FAIL ${r.error}`); }
    }
    queue.unshift({
      id: `office-handcraft-${Date.now()}-${draft.byline.toLowerCase()}`,
      created: new Date().toISOString(),
      byline_id: draft.byline.toLowerCase().replace(/[^a-z]/g, ''),
      byline_display: draft.byline,
      topic_kind: 'office',
      text: draft.text,
      score: 9,  // hand-crafted, manually curated
      status: failure === 0 ? 'posted' : (success > 0 ? 'partial' : 'failed'),
      success_count: success,
      failure_count: failure,
      posted_at: new Date().toISOString(),
      errors,
      handcrafted: true,
    });
    // Small delay between posts to avoid rate limiting
    await new Promise(r => setTimeout(r, 800));
  }

  queue = queue.slice(0, 100);
  await fs.writeFile(queuePath, JSON.stringify(queue, null, 2) + '\n', 'utf8');
  console.log(`\nDone. ${POSTS.length} hand-crafted posts pushed.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
