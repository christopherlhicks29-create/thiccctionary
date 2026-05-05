/**
 * Posts to Buffer for IG / FB / Twitter. Supports four post modes:
 *
 *   POST_MODE=morning   — today's entry, definitions[0] focus, ALL platforms (default)
 *   POST_MODE=afternoon — today's entry, etymology focus, SKIPS Instagram
 *                         (avoids same-image-twice flagging on IG)
 *   POST_MODE=evening   — random archive entry (not from last 2 days), throwback,
 *                         ALL platforms (different image, safe for IG)
 *   POST_MODE=reels     — today's entry, vertical video (Reel) to FB + IG,
 *                         SKIPS Twitter (no Reels concept). Requires
 *                         videos/<date>.mp4 to exist on the live site.
 *
 * Called by:
 *   - .github/workflows/post-on-merge.yml      (POST_MODE=morning + POST_MODE=reels)
 *   - .github/workflows/post-evening.yml       (POST_MODE=evening, cron 03:00 UTC)
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
 *   - POST_MODE               Optional. morning | afternoon | evening | reels. Default: morning.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const stripHtml = s => (s || '').replace(/<[^>]+>/g, '');

function metadataForService(service, mode) {
  if (service === 'twitter' || service === 'x') return undefined;
  if (mode === 'reels') {
    if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'reel' } };
    if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'reel', shouldShareToFeed: true } };
    return undefined;
  }
  if (service === 'facebook' || service === 'facebookpage') return { facebook: { type: 'post' } };
  if (service === 'instagram' || service === 'instagrambusiness') return { instagram: { type: 'post', shouldShareToFeed: true } };
  return undefined;
}

async function postToChannel({ channelId, text, imageUrl, videoUrl, thumbnailUrl, token, service, mode }) {
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
  };

  if (mode === 'reels' && videoUrl) {
    input.assets = { video: { url: videoUrl, thumbnailUrl: thumbnailUrl || undefined } };
  } else {
    input.assets = { images: [{ url: imageUrl }] };
  }

  const metadata = metadataForService(service, mode);
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
    const suffix = `"\n\nFull entry → ${entryUrl}\n\n#thiccctionary #etymology`;
    return fitToX(prefix, body, suffix);
  }
  if (mode === 'evening') {
    const prefix = `📚 From the Thiccctionary archives:\n\n${entry.word} — `;
    const body = stripHtml(entry.definitions[0]);
    const suffix = `\n\nRe-read the full entry → ${entryUrl}\n\n#thiccctionary #throwback #satire`;
    return fitToX(prefix, body, suffix);
  }
  if (mode === 'reels') {
    // Short caption suited to Reels. No URL in caption (Reels strip links anyway).
    return `${entry.word}\n\n${stripHtml(entry.definitions[0])}\n\nFull entry on thiccctionary.com\n\n#wordoftheday #etymology #satire`;
  }
  // morning (default) — rotate through 4 templates by day-of-year so consecutive
  // days don't read identically. Each template targets a slightly different hook.
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const variant = dayOfYear % 4;
  const def0 = stripHtml(entry.definitions[0]);
  const example = stripHtml(entry.example || '').replace(/^"|"$/g, '');

  if (variant === 0) {
    // Standard: emoji + word + definition + URL + hashtags
    const prefix = `📖 ${entry.word}\n\n`;
    const suffix = `\n\nToday's entry → ${baseUrl}\n\n#wordoftheday #etymology #satire`;
    return fitToX(prefix, def0, suffix);
  }
  if (variant === 1) {
    // Sentence-first: lead with the example, drop the headword as the reveal
    const prefix = `Use it in a sentence —\n\n"`;
    const body = example || def0;
    const suffix = `"\n\n— ${entry.word}, today on Thiccctionary\n${baseUrl}\n\n#wordoftheday #etymology`;
    return fitToX(prefix, body, suffix);
  }
  if (variant === 2) {
    // Etymology-forward: lead with the etymology hook
    const ety = stripHtml(entry.etymology || '');
    const prefix = `📚 ${entry.word}\n\nEtymology: `;
    const suffix = `\n\nFull entry → ${baseUrl}\n\n#etymology #wordoftheday`;
    if (ety) return fitToX(prefix, ety, suffix);
    // fallback to standard
    return fitToX(`📖 ${entry.word}\n\n`, def0, `\n\nToday's entry → ${baseUrl}\n\n#wordoftheday`);
  }
  // variant 3 — definitional pause
  const prefix = `Today: ${entry.word}\n\n`;
  const suffix = `\n\nthiccctionary.com\n\n#satire #etymology #wordoftheday`;
  return fitToX(prefix, def0, suffix);
}

function filterChannelsForMode(channels, mode) {
  if (mode === 'afternoon') {
    const skip = new Set(['instagram', 'instagrambusiness']);
    return channels.filter(c => !skip.has(c.service));
  }
  if (mode === 'reels') {
    // Reels only work on FB and IG. Skip Twitter.
    const keep = new Set(['facebook', 'facebookpage', 'instagram', 'instagrambusiness']);
    return channels.filter(c => keep.has(c.service));
  }
  return channels;
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
  if (!['morning', 'afternoon', 'evening', 'reels'].includes(mode)) {
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
  const videoUrl = mode === 'reels' ? `${baseUrl}/videos/${entry.date}.mp4` : null;
  const thumbnailUrl = mode === 'reels' ? imageUrl : null;

  if (mode === 'reels') {
    // Pre-flight check: confirm the video URL is reachable. If not, skip with a clear error.
    try {
      const head = await fetch(videoUrl, { method: 'HEAD' });
      if (!head.ok) {
        console.error(`Reels mode: video URL not reachable (${head.status}). Skipping.`);
        console.error(`URL: ${videoUrl}`);
        process.exit(1);
      }
      console.log(`Video URL verified reachable: ${videoUrl}`);
    } catch (e) {
      console.error(`Reels mode: HEAD check failed for ${videoUrl}: ${e.message}`);
      process.exit(1);
    }
  }

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
  if (mode === 'reels') {
    console.log(`Posting Reel to ${channels.length} channels with video: ${videoUrl}`);
  } else {
    console.log(`Posting to ${channels.length} channels with image: ${imageUrl}`);
  }
  console.log(`--- Post text ---\n${text}\n---`);

  const results = await Promise.all(
    channels.map(({ channelId, service }) =>
      postToChannel({ channelId, text, imageUrl, videoUrl, thumbnailUrl, token: process.env.BUFFER_ACCESS_TOKEN, service, mode })
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
