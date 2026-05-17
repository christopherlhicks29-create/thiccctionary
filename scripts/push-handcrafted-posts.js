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
    text: `Counted hydrants on the way in. Eleven in six blocks on Bleecker. The one in front of the deli has been painted three different colors this year. It is currently cream.

Eliza`
  },
  {
    byline: 'Teddy',
    text: `One submits, for the record, that the Saturn V is a vehicle. Five F-1 engines. 7.5 million pounds of thrust. Whatever 'not technically vehicular' meant in 1969 does not apply now.

Theodore`
  },
  {
    byline: 'Bart',
    text: `Filed objection #50 this morning. The subject was an inflatable raft. Inflatable rafts are not thiccc. They are circumstantially thiccc. The distinction matters.

Bartholomew`
  },
  {
    byline: 'Margie',
    text: `In Sonoma this week. Watched a tractor for ninety minutes. It was, by any reasonable accounting, doing its job. Will assign someone to file something on it eventually.

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

async function postOne(channelId, text) {
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
      const r = await postOne(ch.channelId, draft.text);
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
