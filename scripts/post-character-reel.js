#!/usr/bin/env node
/**
 * Higgsfield character clip → Reels cross-post.
 *
 * Picks an unposted, non-flagged character clip from data/character-clips.json,
 * pushes it through Buffer to FB Reels + IG Reels with its pre-written deadpan
 * caption, and records the post in data/character-clips-posted.json.
 *
 * Why this exists: 28 Higgsfield clips were generated and never surfaced.
 * This loop converts the spend into recurring social posts. Weekly cadence
 * via .github/workflows/character-reel.yml. Manual fire via admin button.
 *
 * Env required: BUFFER_ACCESS_TOKEN, BUFFER_PROFILE_IDS, SITE_BASE_URL
 *
 * Tracker schema (data/character-clips-posted.json):
 *   { "posted": [{ "path": "...", "at": "ISO", "bufferIds": [...] }], "lastPostedAt": "ISO" }
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUFFER_GRAPHQL = 'https://api.buffer.com/';
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/+$/, '');

function metadataForService(service) {
  if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'reel' } };
  if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'reel', shouldShareToFeed: true } };
  return undefined;
}

async function pickClip() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data/character-clips.json'), 'utf8'));
  let tracker = { posted: [], lastPostedAt: null };
  try {
    tracker = JSON.parse(await fs.readFile(path.join(ROOT, 'data/character-clips-posted.json'), 'utf8'));
  } catch {}
  const postedPaths = new Set(tracker.posted.map(p => p.path));
  const eligible = manifest.clips.filter(c =>
    !c.flagged && c.caption && !postedPaths.has(c.path)
  );
  if (eligible.length === 0) {
    // Recycle: pick the oldest-posted clip
    const byAge = [...tracker.posted].sort((a, b) => new Date(a.at) - new Date(b.at));
    if (byAge.length === 0) throw new Error('No clips at all in manifest');
    const recyclePath = byAge[0].path;
    const clip = manifest.clips.find(c => c.path === recyclePath);
    console.log(`All clips posted at least once - recycling oldest: ${clip.path}`);
    return { clip, manifest, tracker, recycled: true };
  }
  // Pick deterministically by day-of-year so two runs the same day don't collide
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const clip = eligible[dayOfYear % eligible.length];
  console.log(`Picked clip ${clip.path} (${eligible.length} eligible)`);
  return { clip, manifest, tracker, recycled: false };
}

async function postToChannel({ channelId, text, videoUrl, token, service }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
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
    assets: { video: { url: videoUrl } },
  };
  const metadata = metadataForService(service);
  if (metadata) input.metadata = metadata;
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, channelId, status: res.status, body: JSON.stringify(json) };
  const result = json.data?.createPost;
  if (result?.message) return { ok: false, channelId, status: 200, body: result.message };
  return { ok: true, channelId, postId: result?.post?.id };
}

function buildCaption(clip, character) {
  // Caption is the clip's pre-written one-liner; tag tail anchors brand.
  const charName = character ? character.name.split(',')[0] : '';
  const lead = clip.caption;
  const tail = `\n\nThiccctionary™. The catalogue stands.\n${SITE}\n\n#thiccctionary`;
  return `${lead}${tail}`;
}

async function main() {
  if (!process.env.BUFFER_ACCESS_TOKEN || !process.env.BUFFER_PROFILE_IDS) {
    console.error('FATAL: BUFFER_ACCESS_TOKEN or BUFFER_PROFILE_IDS not set');
    process.exit(1);
  }
  const { clip, manifest, tracker, recycled } = await pickClip();
  const character = manifest.characters.find(c => c.id === clip.char);
  const text = buildCaption(clip, character);
  const videoUrl = `${SITE}/${clip.path}`;
  console.log(`Posting: ${clip.path}`);
  console.log(`Video URL: ${videoUrl}`);
  console.log(`Caption (${text.length} chars):\n${text}`);

  // Parse channels: "facebook:ID,instagram:ID,twitter:ID"
  const channels = process.env.BUFFER_PROFILE_IDS.split(',').map(s => {
    const [service, id] = s.split(':');
    return { service: service.trim(), channelId: id.trim() };
  }).filter(c => ['facebook', 'facebookpage', 'instagram', 'instagrambusiness'].includes(c.service));

  if (channels.length === 0) {
    console.error('No FB/IG channels found in BUFFER_PROFILE_IDS');
    process.exit(1);
  }

  const bufferIds = [];
  let anyFail = false;
  for (const ch of channels) {
    const r = await postToChannel({
      channelId: ch.channelId,
      text,
      videoUrl,
      token: process.env.BUFFER_ACCESS_TOKEN,
      service: ch.service,
    });
    if (r.ok) {
      console.log(`  ${ch.service}: queued (post ${r.postId})`);
      bufferIds.push({ service: ch.service, id: r.postId });
    } else {
      console.error(`  ${ch.service}: FAIL ${r.status} ${r.body}`);
      anyFail = true;
    }
  }

  // Update tracker even on partial success
  if (recycled) {
    tracker.posted = tracker.posted.filter(p => p.path !== clip.path);
  }
  tracker.posted.push({ path: clip.path, at: new Date().toISOString(), bufferIds });
  tracker.lastPostedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(ROOT, 'data/character-clips-posted.json'),
    JSON.stringify(tracker, null, 2)
  );
  console.log(`Tracker updated. Total posted: ${tracker.posted.length} of ${manifest.clips.filter(c => !c.flagged).length} eligible clips.`);

  if (anyFail) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
