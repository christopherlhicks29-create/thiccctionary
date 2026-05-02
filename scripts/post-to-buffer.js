/**
 * Posts to Buffer for IG / FB / Twitter. Supports three post modes:
 *
 *   POST_MODE=morning   — today's entry, definitions[0] focus, ALL platforms (default)
 *   POST_MODE=afternoon — today's entry, etymology focus, SKIPS Instagram
 *                         (avoids same-image-twice flagging on IG)
 *   POST_MODE=evening   — random archive entry (not from last 2 days), throwback,
 *                         ALL platforms (different image, safe for IG)
 *
 * Called by:
 *   - .github/workflows/post-on-merge.yml      (POST_MODE=morning, on PR merge)     [scheduled]
 *   - .github/workflows/post-evening.yml       (POST_MODE=evening, cron 03:00 UTC)  [scheduled]
 *   - .github/workflows/post-afternoon.yml     (POST_MODE=afternoon)                [manual only]
 *   - .github/workflows/test-buffer.yml        (manual)
 *
 * Uses Buffer's GraphQL API (post-2024). Personal Keys only work here,
 * not the legacy REST endpoint.
 *
 * Required env vars:
 *   - BUFFER_ACCESS_TOKEN     Personal Key from buffer.com → API
 *   - BUFFER_PROFILE_IDS      Comma-separated channel IDs (one per platform)
 *                             Format: "twitter:ID,facebook:ID,instagram:ID"
 *   - SITE_BASE_URL           e.g. https://thiccctionary.com
 *   - POST_MODE               Optional. morning | afternoon | evening. Default: morning.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const stripHtml = s => (s || '').replace(/<[^>]+>/g, '');

function metadataForService(service) {
  if (service === 'twitter' || service === 'x') return undefined;
  if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'post' } };
  if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'post', shouldShareToFeed: true } };
  return undefined;
}

async function postToChannel({ channelId, text, imageUrl, token, service }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
          }
        }
        ... on MutationError {
          message
        }
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
  const metadata = metadataForService(service);
  if (metadata) input.metadata = metadata;

  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) return { ok: false, channelId, status: res.status, body: JSON.stringify(json) };
  if (json.errors && json.errors.length > 0) return { ok: false, channelId, status: 200, body: JSON.stringify(json.errors) };
  const result = json.data?.createPost;
  if (result?.message) return { ok: false, channelId, status: 200, body: result.message };
  return { ok: true, channelId, postId: result?.post?.id };
}

function pickEntry(entries, mode) {
  if (mode === 'evening') {
    const candidates = entries.slice(2);
    if (candidates.length === 0) {
      console.log('Archive has fewer than 3 entries; evening post falls back to most recent.');
      return entries[0];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return entries[0];
}

// Twitter free-tier cap is 280 chars. Truncate any excess body text with an ellipsis
// so we don't lose the whole post if a future entry has an unusually long example.
const X_LIMIT = 280;
function fitToX(prefix, body, suffix) {
  const overhead = prefix.length + suffix.length;
  const room = X_LIMIT - overhead;
  if (body.length <= room) return prefix + body + suffix;
  return prefix + body.slice(0, Math.max(0, room - 1)).trimEnd() + '…' + suffix;
}

function buildText(entry, mode, baseUrl) {
  const entryUrl = `${baseUrl}/entries/${entry.date}.html`;
  if (mode === 'afternoon') {
    // Example sentence (naturally short, illustrative, satirical) — fits X easily.
    const prefix = `📝 Use it in a sentence — ${entry.word}\n\n"`;
    const body = stripHtml(entry.example || entry.definitions[0]);
    const suffix = `"\n\nFull entry → ${entryUrl}\n\n#thiccctionary #thiccc`;
    return fitToX(prefix, body, suffix);
  }
  if (mode === 'evening') {
    const prefix = `📚 From the Thiccctionary archives:\n\n${entry.word} — `;
    const body = stripHtml(entry.definitions[0]);
    const suffix = `\n\nRe-read the full entry → ${entryUrl}\n\n#thiccctionary #throwback #thiccc`;
    return fitToX(prefix, body, suffix);
  }
  // morning (default)
  const prefix = `📖 ${entry.word}\n\n`;
  const body = stripHtml(entry.definitions[0]);
  const suffix = `\n\nToday's entry → ${baseUrl}\n\n#thiccctionary #thiccc #everydayobjects`;
  return fitToX(prefix, body, suffix);
}

function filterChannelsForMode(channels, mode) {
  if (mode !== 'afternoon') return channels;
  const skip = new Set(['instagram', 'instagrambusiness']);
  return channels.filter(c => !skip.has(c.service));
}

async function main() {
  if (!process.env.BUFFER_ACCESS_TOKEN || !process.env.BUFFER_PROFILE_IDS) {
    console.log('Buffer not configured. Skipping.');
    return;
  }
  if (!process.env.SITE_BASE_URL) {
    console.error('SITE_BASE_URL not set.');
    process.exit(1);
  }

  const mode = (process.env.POST_MODE || 'morning').toLowerCase();
  if (!['morning', 'afternoon', 'evening'].includes(mode)) {
    console.error(`Invalid POST_MODE="${mode}".`);
    process.exit(1);
  }
  console.log(`Post mode: ${mode}`);

  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  if (entries.length === 0) {
    console.log('No entries found.');
    return;
  }
  const entry = pickEntry(entries, mode);
  console.log(`Selected entry: ${entry.date} -- "${entry.word}"`);

  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
  const imageUrl = `${baseUrl}/${entry.image}`;
  const allChannels = process.env.BUFFER_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const idx = s.indexOf(':');
    if (idx === -1) return { service: null, channelId: s };
    return { service: s.slice(0, idx).toLowerCase(), channelId: s.slice(idx + 1) };
  });
  const channels = filterChannelsForMode(allChannels, mode);
  if (channels.length === 0) {
    console.log(`No channels match mode "${mode}".`);
    return;
  }
  if (channels.length < allChannels.length) {
    console.log(`Mode "${mode}" filters to ${channels.length} of ${allChannels.length} channels.`);
  }

  const text = buildText(entry, mode, baseUrl);
  console.log(`Posting to ${channels.length} channels with image: ${imageUrl}`);
  console.log(`--- Post text ---\n${text}\n---`);

  const results = await Promise.all(
    channels.map(({ channelId, service }) =>
      postToChannel({ channelId, text, imageUrl, token: process.env.BUFFER_ACCESS_TOKEN, service })
    )
  );

  let successes = 0;
  let failures = 0;
  for (const r of results) {
    if (r.ok) {
      successes++;
      console.log(`OK channel ${r.channelId} (post id: ${r.postId})`);
    } else {
      failures++;
      console.error(`FAIL channel ${r.channelId}: status=${r.status} body=${r.body}`);
    }
  }
  console.log(`\nSummary: ${successes} succeeded, ${failures} failed (out of ${results.length}).`);
  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
