/**
 * Wave 230: cross-post a Thiccctionary Editorial Panel (static newspaper cartoon)
 * to FB + IG (Twitter optional) via Buffer.
 *
 * Panels live at images/cartoons/<id>.png with a sibling manifest entry in
 * data/editorial-panels.json. Picks one unposted panel per run, posts the
 * pre-written caption, records the post to data/editorial-panels-posted.json.
 *
 * Required env:
 *   BUFFER_ACCESS_TOKEN     Buffer Personal Key
 *   BUFFER_PROFILE_IDS      "facebook:<id>,instagram:<id>[,twitter:<id>]"
 *   SITE_BASE_URL           e.g. https://thiccctionary.com
 *
 * Optional env:
 *   PANEL_ID                force a specific panel id (skip the picker)
 *   DRY_RUN=1               do not actually POST
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILE_IDS = process.env.BUFFER_PROFILE_IDS || '';
const DRY = !!process.env.DRY_RUN;

if (!TOKEN) { console.error('FATAL: BUFFER_ACCESS_TOKEN missing'); process.exit(1); }
if (!PROFILE_IDS) { console.error('FATAL: BUFFER_PROFILE_IDS missing'); process.exit(1); }

const channels = PROFILE_IDS.split(',').map(s => {
  const [service, id] = s.trim().split(':');
  return { service: (service || '').toLowerCase(), id };
}).filter(c => c.service && c.id);

if (channels.length === 0) { console.error('FATAL: no channels parsed from BUFFER_PROFILE_IDS'); process.exit(1); }

function metadataForService(service) {
  if (service === 'facebook' || service === 'facebookpage') return undefined;
  if (service === 'instagram' || service === 'instagrambusiness') return undefined;
  if (service === 'twitter') return undefined;
  return undefined;
}

async function pickPanel() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'editorial-panels.json'), 'utf8'));
  const trackerPath = path.join(ROOT, 'data', 'editorial-panels-posted.json');
  let tracker = { posted: [], lastPostedAt: null };
  try { tracker = JSON.parse(await fs.readFile(trackerPath, 'utf8')); } catch (_) {}
  const postedIds = new Set(tracker.posted.map(p => p.id));

  const forced = (process.env.PANEL_ID || '').trim();
  if (forced) {
    const p = manifest.panels.find(x => x.id === forced);
    if (!p) { console.error(`FATAL: PANEL_ID="${forced}" not found in manifest`); process.exit(1); }
    return { panel: p, manifest, tracker, trackerPath, recycle: false };
  }

  const candidates = manifest.panels.filter(p => !postedIds.has(p.id));
  if (candidates.length > 0) {
    return { panel: candidates[0], manifest, tracker, trackerPath, recycle: false };
  }
  // All posted at least once: recycle the oldest posted entry.
  const oldest = [...tracker.posted].sort((a, b) => new Date(a.at) - new Date(b.at))[0];
  const panel = manifest.panels.find(p => p.id === oldest.id);
  console.log(`[panel] all panels posted at least once; recycling oldest: ${oldest.id}`);
  return { panel, manifest, tracker, trackerPath, recycle: true };
}

async function headCheck(url, attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return { ok: true, status: res.status, attempt: i };
      console.log(`HEAD ${url} attempt ${i}: ${res.status}`);
    } catch (e) {
      console.log(`HEAD ${url} attempt ${i}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return { ok: false };
}

async function postToChannel({ channelId, text, imageUrl, service }) {
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
    assets: { images: [{ url: imageUrl }] },
  };
  const md = metadataForService(service);
  if (md) input.metadata = md;
  if (DRY) {
    console.log(`[DRY] would post to ${service}/${channelId}:\n  text=${text}\n  img=${imageUrl}`);
    return { ok: true, dry: true, channelId, service };
  }
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const body = await res.text();
  let json = {}; try { json = JSON.parse(body); } catch (_) {}
  // Surface MutationError messages explicitly (the GraphQL union returns ok:200 with embedded error)
  const mutErr = json?.data?.createPost?.message;
  const ok = res.ok && !json.errors && !mutErr;
  if (!ok) {
    console.log(`  [post] ${service}/${channelId} FAIL body=${body.slice(0,400)}`);
  }
  return { ok, status: res.status, body, channelId, service, json, mutErr };
}

async function main() {
  const { panel, tracker, trackerPath, recycle } = await pickPanel();
  const imagePath = path.join(ROOT, panel.image);
  try { await fs.access(imagePath); } catch (_) {
    console.error(`FATAL: panel image missing on disk: ${imagePath}`);
    process.exit(1);
  }
  const imageUrl = `${SITE}/${panel.image}`;
  const text = `${panel.caption}\n${SITE}/cartoons/  #thiccctionary`;

  console.log(`Panel:   ${panel.id} (${panel.subject})`);
  console.log(`Image:   ${imageUrl}`);
  console.log(`Caption:\n---\n${text}\n---`);

  // HEAD-check the image URL with retry, for CF Pages deploy race.
  console.log('Checking image URL reachability...');
  const head = await headCheck(imageUrl, 10);
  if (!head.ok && !DRY) {
    console.error(`FATAL: image URL not reachable after retries: ${imageUrl}`);
    process.exit(1);
  }

  const results = [];
  for (const c of channels) {
    const r = await postToChannel({ channelId: c.id, text, imageUrl, service: c.service });
    results.push(r);
    console.log(`  ${c.service}/${c.id}: ${r.ok ? 'OK' : 'FAIL'} ${r.status || ''}`);
    if (!r.ok && r.body) console.log(`    body=${r.body.slice(0, 200)}`);
  }

  const okCount = results.filter(r => r.ok).length;
  if (okCount === 0 && !DRY) {
    console.error('All channel posts failed.');
    process.exit(2);
  }

  if (!DRY) {
    tracker.posted.push({
      id: panel.id,
      at: new Date().toISOString(),
      bufferIds: results.filter(r => r.ok && !r.dry).map(r => ({
        service: r.service,
        id: r.json?.data?.createPost?.post?.id || null,
      })),
      recycle,
    });
    tracker.lastPostedAt = new Date().toISOString();
    await fs.writeFile(trackerPath, JSON.stringify(tracker, null, 2) + '\n');
    console.log(`Tracker updated: ${tracker.posted.length} total posts; lastPostedAt=${tracker.lastPostedAt}`);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
