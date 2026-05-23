/**
 * Wave 198: cross-post a Thiccctionary cartoon to FB + IG Reels via Buffer.
 *
 * Cartoons live at videos/cartoons/<id>.mp4 with a sibling manifest at
 * data/cartoons/<id>.json. The manifest carries the caption-able title;
 * the strongest narration line is extracted for the post text.
 *
 * Required env:
 *   BUFFER_ACCESS_TOKEN     Buffer Personal Key
 *   BUFFER_PROFILE_IDS      "facebook:<id>,instagram:<id>" (twitter skipped for cartoons)
 *   SITE_BASE_URL           e.g. https://thiccctionary.com
 *   CARTOON_ID              e.g. ep00-welcome
 *
 * Optional env:
 *   CARTOON_CAPTION_OVERRIDE  hand-write the post text (skips manifest extraction)
 *   DRY_RUN=1                 don't actually POST to Buffer, just log
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const CARTOON_ID = (process.env.CARTOON_ID || '').trim();
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILE_IDS = process.env.BUFFER_PROFILE_IDS || '';

if (!CARTOON_ID) { console.error('FATAL: CARTOON_ID env var required'); process.exit(1); }
if (!TOKEN) { console.error('FATAL: BUFFER_ACCESS_TOKEN missing'); process.exit(1); }
if (!PROFILE_IDS) { console.error('FATAL: BUFFER_PROFILE_IDS missing'); process.exit(1); }

const MANIFEST_PATH = path.join(ROOT, 'data', 'cartoons', `${CARTOON_ID}.json`);
const VIDEO_PATH    = path.join(ROOT, 'videos', 'cartoons', `${CARTOON_ID}.mp4`);
const VIDEO_URL     = `${SITE}/videos/cartoons/${CARTOON_ID}.mp4`;

function metadataForService(service) {
  if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'reel' } };
  if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'reel', shouldShareToFeed: true } };
  return undefined;
}

function buildCaption(manifest) {
  // Caption recipe: context line (usually the title-card narration) + a
  // punchline line (a later narration with a comedic beat). The video
  // carries the rest. Falls back gracefully if either is missing.
  const lines = (manifest.segments || [])
    .map(s => (s.narration || '').trim())
    .filter(n => n && n.split(/\s+/).length >= 1 && n.split(/\s+/).length <= 25);
  // CONTEXT: first long-form narration (40+ chars with punctuation). Orients
  // a cold viewer who has never seen the brand.
  const context = lines.find(l => /[.!?]/.test(l) && l.length > 40);
  // PUNCHLINE: a later line with comedic signal - medium length (15-100 chars),
  // with a comma (indicates a beat) or a brand-tag phrase.
  const punchline = lines.find(l =>
    l !== context &&
    /[.!?]/.test(l) &&
    l.length >= 15 && l.length <= 100 &&
    (l.includes(',') || /\b(in a mood|properly understood|approximately|technically|on a Tuesday)\b/i.test(l))
  );
  let hook;
  if (context && punchline) hook = `${context} ${punchline}`;
  else hook = context || punchline || lines[0] || manifest.title;
  return `${hook}\n${SITE}  #thiccctionary`;
}

async function postToChannel({ channelId, text, service }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id text dueAt } }
        ... on MutationError { message }
      }
    }
  `;
  const input = {
    channelId,
    text,
    schedulingType: 'automatic',
    mode: 'addToQueue',
    assets: { video: { url: VIDEO_URL } },
    metadata: metadataForService(service),
  };
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body, channelId, service };
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  try { await fs.access(VIDEO_PATH); } catch (e) {
    console.error(`FATAL: cartoon video not found at ${VIDEO_PATH}`);
    process.exit(1);
  }
  const caption = (process.env.CARTOON_CAPTION_OVERRIDE || '').trim() || buildCaption(manifest);
  console.log(`Cartoon: ${manifest.title} (${CARTOON_ID})`);
  console.log(`Video:   ${VIDEO_URL}`);
  console.log(`Caption:\n---\n${caption}\n---`);

  // HEAD-check the video URL with retries (Cloudflare Pages deploy race).
  console.log('Checking video URL reachability...');
  let reachable = false;
  for (let i = 1; i <= 10; i++) {
    try {
      const head = await fetch(VIDEO_URL, { method: 'HEAD' });
      if (head.status === 200) { reachable = true; console.log(`  attempt ${i}: HTTP 200, ready`); break; }
      console.log(`  attempt ${i}: HTTP ${head.status}, retrying...`);
    } catch (e) {
      console.log(`  attempt ${i}: ${e.message}, retrying...`);
    }
    if (i < 10) await new Promise(r => setTimeout(r, 15_000));
  }
  if (!reachable) {
    console.warn('::warning::Video URL never returned 200, posting anyway (Buffer may catch up)');
  }

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN=1, skipping Buffer post');
    return;
  }

  // Parse profile IDs: format "facebook:abc123,instagram:xyz789,twitter:foo".
  // Skip Twitter for cartoons (video posts there don't behave well).
  const channels = PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean)
    .map(s => {
      const idx = s.indexOf(':');
      return idx === -1 ? { service: null, channelId: s } : { service: s.slice(0, idx).toLowerCase(), channelId: s.slice(idx + 1) };
    })
    .filter(c => c.service && c.service !== 'twitter' && c.service !== 'x');

  if (channels.length === 0) {
    console.error('FATAL: no FB/IG channels in BUFFER_PROFILE_IDS');
    process.exit(1);
  }

  console.log(`Posting to ${channels.length} channel(s):`);
  const results = await Promise.all(channels.map(c => postToChannel({ channelId: c.channelId, text: caption, service: c.service })));
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r.ok && !r.body.includes('"errors"') && !r.body.includes('MutationError')) {
      ok++;
      console.log(`  ${r.service}/${r.channelId}: OK`);
    } else {
      fail++;
      console.error(`  ${r.service}/${r.channelId}: FAIL status=${r.status}`);
      console.error(`    body: ${r.body.slice(0, 500)}`);
    }
  }
  console.log(`\nResult: ${ok} succeeded, ${fail} failed`);
  if (fail > 0 && ok === 0) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
