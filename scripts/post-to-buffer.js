/**
 * Posts to Buffer for IG / FB / Twitter. Supports four post modes:
 *
 *   POST_MODE=morning , today's entry, definitions[0] focus, ALL platforms (default)
 *   POST_MODE=afternoon, today's entry, etymology focus, SKIPS Instagram
 *                         (avoids same-image-twice flagging on IG)
 *   POST_MODE=evening , random archive entry (not from last 2 days), throwback,
 *                         ALL platforms (different image, safe for IG)
 *   POST_MODE=reels   , today's entry, vertical video (Reel) to FB + IG,
 *                         SKIPS Twitter (no Reels concept). Requires
 *                         videos/<date>.mp4 to exist on the live site.
 *   POST_MODE=article , long-form article promotion, rotates through
 *                         data/articles.json by ISO week. Uses the
 *                         per-article OG card as the image. ALL platforms.
 *
 * Called by:
 *   - .github/workflows/post-on-merge.yml      (POST_MODE=morning + POST_MODE=reels)
 *   - .github/workflows/post-evening.yml       (POST_MODE=evening, cron 03:00 UTC)
 *   - .github/workflows/post-afternoon.yml     (POST_MODE=afternoon)                [manual only]
 *   - .github/workflows/post-article.yml       (POST_MODE=article, cron weekly)
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
 *   - POST_MODE               Optional. morning | afternoon | evening | reels | article. Default: morning.
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

function pickArticle(articles) {
  // Rotate by ISO week so consecutive weekly cron runs land on different
  // articles. Articles list is small (~10), so weekOfYear mod len cycles
  // through the whole catalog every ~10 weeks.
  if (!articles || articles.length === 0) return null;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const weekOfYear = Math.ceil(dayOfYear / 7);
  return articles[weekOfYear % articles.length];
}

function buildArticleText(article, baseUrl) {
  const articleUrl = `${baseUrl}/articles/${article.slug}.html`;
  // Description first, that's the hook. Title lands as a tag after the body,
  // with the URL as a quiet footer. No "Read →" beg.
  const body = article.description || article.title || '';
  const prefix = '';
  const suffix = `\n\n${article.title}\n${articleUrl}\n\n#thiccctionary`;
  return fitToX(prefix, body, suffix);
}

function pickEntry(entries, mode) {
  // Wave 80: TARGET_DATE override lets us backfill posts for a specific entry
  // without touching the entries.json order. Useful when entries[0] is something
  // we don't want to post (e.g., a submission) but we need to retry the daily
  // entry's cross-post.
  const targetDate = (process.env.TARGET_DATE || '').trim();
  if (targetDate) {
    const found = entries.find(e => e.date === targetDate);
    if (found) {
      console.log(`TARGET_DATE override: posting for ${targetDate}, ${found.word}`);
      return found;
    }
    console.warn(`TARGET_DATE=${targetDate} but no entry with that date. Falling back to default.`);
  }
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

// Wave 87, punchline pool. Brand-voice asides that ride along with every
// post so the CAPTION carries comedy work, not just whatever entry data
// happens to be funny. Universal-ish (not category-specific). Add to this
// pool freely; just keep entries deadpan, short, and on-brand.
const PUNCHLINES = [
  'We had to add a third c.',
  'Look at her.',
  "Don't tell us it isn't a body.",
  'Some objects request space. This one took it.',
  "There's haul. And then there's haunch.",
  'Built for capacity. Engineered with intent.',
  'Inertia like a personality trait.',
  'A masterclass in mass.',
  'This is presence, not pretense.',
  'It does not blink. It does not need to.',
  'Volume is doing all the talking.',
  'File under: structural integrity, emotional weight.',
  'Some things just are.',
  'Heavy is a personality.',
  "We're not saying anything. The shape is.",
  'A confident occupancy of space.',
  'Architectural confidence.',
  "This is what 'presence' is doing in the dictionary.",
  'The committee finds it in compliance.',
  "We don't make the rules. The volume does.",
];

// Deterministic punchline pick. Same (date, mode) always yields the same line
// so retries/backfills are reproducible, but a single day's morning/afternoon/
// evening posts pull different lines.
function pickPunchline(entry, mode) {
  const seed = (entry.date || '') + ':' + mode;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return PUNCHLINES[Math.abs(h) % PUNCHLINES.length];
}

// Observation-voice templates with punchline pool. Each variant pairs entry
// data (example/definition) with a brand-voice aside so the caption itself
// does comedy work regardless of how dry the entry data happens to be.
//
// Wave 89: Bespoke caption preferred when `entry.socialCaptions[mode]` is set.
// Hand-written (or LLM-generated at entry-gen time, see QUEUED-FOLLOWUPS) per
// entry so the caption references real specifics about THAT subject instead of
// a universal one-liner. Falls back to template below if absent.
function buildText(entry, mode, baseUrl) {
  const entryUrl = `${baseUrl}/entries/${entry.date}.html`;

  // Wave 89: bespoke caption path.
  const bespoke = entry.socialCaptions && typeof entry.socialCaptions[mode] === 'string'
    ? entry.socialCaptions[mode].trim()
    : '';
  if (bespoke) {
    if (mode === 'reels') {
      return `${bespoke}\n\nFull entry on thiccctionary.com\n\n#thiccctionary #wordoftheday`;
    }
    // Wave 99: submission CTA on non-Reels, drives participation. Reels keep
    // the existing shape because Reels strip links.
    const cta = `\n\nSpotted a thiccc thing? → ${baseUrl}/submit.html`;
    const suffix = `${cta}\n\n${entryUrl}\n\n#thiccctionary`;
    return fitToX('', bespoke, suffix);
  }

  // Fallback path: Wave 86/87 templated captions.
  const def0 = stripHtml(entry.definitions[0]);
  const example = stripHtml(entry.example || '').replace(/^"|"$/g, '').trim();
  const punch = pickPunchline(entry, mode);

  if (mode === 'afternoon') {
    // Example + punchline + word tag.
    const body = example || def0;
    const suffix = `\n\n${punch}\n\nThat's ${entry.word.toLowerCase()}.\n${entryUrl}\n\n#thiccctionary`;
    return fitToX('', body, suffix);
  }

  if (mode === 'evening') {
    // Archive callback. Definition + word + punchline kicker.
    const body = def0;
    const prefix = `From the archives:\n\n`;
    const suffix = `\n\n${entry.word}. ${punch}${sig}\n${entryUrl}\n\n#thiccctionary`;
    return fitToX(prefix, body, suffix);
  }

  if (mode === 'reels') {
    // Reels strip links. Example + punchline + word.
    const lead = example || def0;
    return `${lead}\n\n${punch}\n\n${entry.word}.\n\nFull entry on thiccctionary.com\n\n#thiccctionary #wordoftheday`;
  }

  // morning, rotate 4 chassis by day-of-year. Each one is a clearly distinct
  // shape so a follower's feed doesn't read identical day to day.
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const variant = dayOfYear % 4;

  if (variant === 0) {
    // Example + punchline kicker + word tag.
    const body = example || def0;
    const suffix = `\n\n${punch}\n\nToday's entry: ${entry.word}.\n${baseUrl}\n\n#thiccctionary`;
    return fitToX('', body, suffix);
  }
  if (variant === 1) {
    // Definition + punchline + word reveal. Definition-led for variety.
    const body = def0;
    const suffix = `\n\n${punch}\n\n${entry.word}.\n${baseUrl}\n\n#thiccctionary`;
    return fitToX('', body, suffix);
  }
  if (variant === 2) {
    // Punchline-led, minimal. Image carries the rest. (Replaces the old
    // etymology variant, which depended on entry data that landed thiccc
    // jokes only 28% of the time.)
    const body = punch;
    const suffix = `\n\n${entry.word}, today on Thiccctionary.\n${baseUrl}\n\n#thiccctionary`;
    return fitToX('', body, suffix);
  }
  // variant 3, example + em-dash word + punchline as kicker.
  const body = example || def0;
  const suffix = `\n\n${entry.word}. ${punch}\n${baseUrl}\n\n#thiccctionary`;
  return fitToX('', body, suffix);
}

function filterChannelsForMode(channels, mode) {
  let filtered = channels;
  if (mode === 'morning') {
    // Wave 91: Instagram rejects images outside 4:5 to 1.91:1. Unsplash photos
    // often fall outside that range. Skip IG for the morning image post;
    // IG still gets Reels (9:16) via post-on-merge.yml's reels step.
    const skip = new Set(['instagram', 'instagrambusiness']);
    filtered = filtered.filter(c => !skip.has(c.service));
  } else if (mode === 'afternoon') {
    const skip = new Set(['instagram', 'instagrambusiness']);
    filtered = filtered.filter(c => !skip.has(c.service));
  } else if (mode === 'reels') {
    // Reels only work on FB and IG. Skip Twitter.
    const keep = new Set(['facebook', 'facebookpage', 'instagram', 'instagrambusiness']);
    filtered = filtered.filter(c => keep.has(c.service));
  }
  // SKIP_FACEBOOK=true tells Buffer to skip FB channels, used when the
  // direct-FB Graph API script is handling FB. Reels mode still goes
  // through Buffer for FB (no direct-FB Reels support yet).
  if (process.env.SKIP_FACEBOOK === 'true' && mode !== 'reels') {
    const fb = new Set(['facebook', 'facebookpage']);
    filtered = filtered.filter(c => !fb.has(c.service));
    if (filtered.length === channels.length) {
      console.log('SKIP_FACEBOOK=true but no FB channels were in the list anyway.');
    } else {
      console.log('SKIP_FACEBOOK=true, Buffer will not post to FB; direct-FB script handles it.');
    }
  }
  return filtered;
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
  if (!['morning', 'afternoon', 'evening', 'reels', 'article'].includes(mode)) {
    console.error(`Invalid POST_MODE="${mode}".`);
    process.exit(1);
  }
  console.log(`Post mode: ${mode}`);

  // ---- article mode: independent from entries.json ----
  if (mode === 'article') {
    const articlesPath = path.join(ROOT, 'data', 'articles.json');
    let articles;
    try {
      articles = JSON.parse(await fs.readFile(articlesPath, 'utf8'));
    } catch (e) {
      console.error(`Could not read ${articlesPath}: ${e.message}`);
      process.exit(1);
    }
    const article = pickArticle(articles);
    if (!article) {
      console.error('No articles found in data/articles.json.');
      process.exit(1);
    }
    console.log(`Selected article: ${article.slug} -- "${article.title}"`);

    const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
    const imageUrl = `${baseUrl}/articles/og/${article.slug}.png`;
    const text = buildArticleText(article, baseUrl);

    const allChannels = process.env.BUFFER_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const idx = s.indexOf(':');
      if (idx === -1) return { service: null, channelId: s };
      return { service: s.slice(0, idx).toLowerCase(), channelId: s.slice(idx + 1) };
    });
    if (allChannels.length === 0) {
      console.log('No channels configured.');
      return;
    }

    console.log(`Posting article promo to ${allChannels.length} channels with image: ${imageUrl}`);
    console.log(`--- Post text ---\n${text}\n---`);

    const results = await Promise.all(
      allChannels.map(({ channelId, service }) =>
        postToChannel({ channelId, text, imageUrl, videoUrl: null, thumbnailUrl: null, token: process.env.BUFFER_ACCESS_TOKEN, service, mode: 'morning' })
      )
    );

    let successes = 0, failures = 0;
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
    return;
  }

  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  if (entries.length === 0) {
    console.log('No entries found.');
    return;
  }
  const entry = pickEntry(entries, mode);
  console.log(`Selected entry: ${entry.date} -- "${entry.word}"`);

  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
  // Wave 79: entry.image may be relative ('images/2026-05-10.jpg') OR an
  // absolute URL (submission entries store the R2 public URL directly).
  // Don't double-prefix absolute URLs.
  const isAbsolute = /^https?:\/\//i.test(entry.image || '');
  const imageUrl = isAbsolute ? entry.image : `${baseUrl}/${entry.image}`;
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
