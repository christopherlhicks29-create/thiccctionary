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

import { contextFor as bibleContextFor } from './lib/office-bible.js';
import { critiqueImage, passesGate, GATES } from './image-critic.js';

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
    // Wave 293: Buffer's createPost now REJECTS video.thumbnailUrl outright
    // ("Invalid post input: Video thumbnailUrl is not supported"). This was
    // the entire FB-Reels failure since mid-June. Networks never accepted
    // custom thumbnails anyway; thumbnail selection is metadata.thumbnailOffset
    // (IG/TikTok/Pinterest only), which we leave at default (first frame).
    input.assets = { video: { url: videoUrl } };
  } else if (imageUrl) {
    input.assets = { image: { url: imageUrl } };
  }
  // else: text-only post (office mode), no assets attached

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

// Wave 159: in-process retry wrapper. TRANSIENT errors (rate limit, 5xx,
// network) get retried up to 2 times with exponential backoff. SCHEMA and
// TERMINAL errors are NOT retried inline (retrying with the same code
// would produce the same failure; the hourly cron sweep handles those
// after a code fix lands).
function classifyForInProcess(result) {
  if (result.ok) return 'OK';
  const blob = (result.body || '').toString().toLowerCase();
  if (blob.includes('schedulingtype') || blob.includes('does not exist in')) return 'SCHEMA';
  if (blob.includes('rate limit') || result.status === 429) return 'TRANSIENT';
  if (typeof result.status === 'number' && result.status >= 500) return 'TRANSIENT';
  if (blob.includes('network') || blob.includes('timeout') || blob.includes('econnreset') || blob.includes('fetch failed')) return 'TRANSIENT';
  if (blob.includes('channel not found') || blob.includes('account suspended') || blob.includes('unauthorized') || blob.includes('whoops')) return 'TERMINAL';
  return 'UNKNOWN';
}

async function postToChannelWithRetry(args) {
  const MAX_ATTEMPTS = 3;
  const BACKOFFS = [0, 2000, 5000];
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFFS[attempt] > 0) await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
    const r = await postToChannel(args);
    if (r.ok) {
      if (attempt > 0) console.log(`  recovered on attempt ${attempt + 1} for channel ${r.channelId}`);
      return r;
    }
    last = r;
    const klass = classifyForInProcess(r);
    if (klass === 'SCHEMA' || klass === 'TERMINAL') {
      console.warn(`  channel ${r.channelId}: ${klass} error, not retrying inline`);
      return r;
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      console.warn(`  channel ${r.channelId}: ${klass} on attempt ${attempt + 1}, retrying in ${BACKOFFS[attempt + 1]}ms`);
    }
  }
  return last;
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

// Wave 117: weighted byline picker for social posts. ~20% unsigned brand voice.
function pickSocialByline() {
  const dist = [
    { id: 'eli', display: 'Eli', weight: 35 },
    { id: 'teddy', display: 'Teddy', weight: 25 },
    { id: 'bart', display: 'Bart', weight: 15 },
    { id: 'margie', display: 'Margie', weight: 3 },
    { id: 'spider', display: 'Spider', weight: 2 },
    { id: null, display: null, weight: 20 },
  ];
  const total = dist.reduce((a, x) => a + x.weight, 0);
  let r = Math.random() * total;
  for (const d of dist) { r -= d.weight; if (r <= 0) return d; }
  return dist[dist.length - 1];
}

// Wave 127: rewrite caption in a byline's voice via Claude. Returns null on failure.
async function rewriteInBylineVoice(entry, byline, mode, baseUrl) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY || !byline?.id || !byline?.display) return null;
  let staffData;
  try {
    const staffRaw = await fs.readFile(path.join(ROOT, 'data', 'editorial-staff.json'), 'utf8');
    staffData = JSON.parse(staffRaw);
  } catch (e) { return null; }
  const member = staffData.staff.find(x => x.id === byline.id);
  if (!member) return null;

  const def = stripHtml(entry.definitions?.[0] || entry.definition || '').slice(0, 250);
  const example = stripHtml(entry.example || '').replace(/^"|"$/g, '').trim().slice(0, 200);
  const MAX_BODY = 200;

  const system = `You are ${member.name}, ${member.title} at Thiccctionary.

VOICE: ${member.voice}

OBSESSIONS: ${(member.obsessions || []).join('; ')}
TICS: ${(member.tics || []).join('; ')}

You are writing a SHORT social media post about today's catalogue entry. Hard rules:
- Less than or equal to ${MAX_BODY} characters total INCLUDING your signature on the final line
- THIS IS A SOCIAL POST, NOT an essay or narration. Conversational, punchy, present-tense observation.
- STRUCTURE: lead with the subject, then the dry punchline. Land it fast.
- BANNED openers: "The X marched...", "There is a particular...", "Consider the...", "One submits...", "This writer notes..." 
- Voice is DRY in attitude, SHORT in rhythm.
- No em-dashes (commas, periods, colons, parens)
- No banned phrases: embodies, transcends, intersection, tapestry, symphony, captures the essence, stands as a testament, "not just X, but Y"
- ACCESSIBILITY: names are FINE for attribution and continuity (build cast recognition over time). The SITUATION must parse for strangers, they need to understand WHAT happened even if they don't yet know WHO the person is. Reject only if the post requires insider knowledge of running bits to even parse the event.
- Make it FUNNY about the SUBJECT, not about the office.
- End with your first name "${byline.display}" on its own line.
- Output the post text only. No commentary, no quotes around it.

${await bibleContextFor(byline.id)}`;

  const user = `Today's entry:
Subject: ${entry.word}
Definition: ${def}
${example ? 'Example: ' + example : ''}

Write a ${mode} post in YOUR voice. Sign with your first name on the final line.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, system, messages: [{ role: 'user', content: user }], temperature: 0.8 }),
    });
    if (!res.ok) { console.error('[byline-rewrite] Claude', res.status); return null; }
    const data = await res.json();
    let text = (data.content?.[0]?.text || '').trim().replace(/^["']+|["']+$/g, '');
    if (!text || text.length > MAX_BODY + 10) { console.error('[byline-rewrite] bad length', text.length); return null; }
    text = text.replace(/ — /g, ', ').replace(/ —/g, ',').replace(/— /g, '').replace(/—/g, ', ');
    return text;
  } catch (e) { console.error('[byline-rewrite] error', e.message); return null; }
}

async function pickEntry(entries, mode, baseUrl) {
  // Wave 80: TARGET_DATE override lets us backfill posts for a specific entry
  // without touching the entries.json order.
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
    // Wave 204: critic-gated throwback. Sample up to 4 random entries and run
    // each through the image critic. Pick the first one whose image passes the
    // throwback gate. Prevents shipping coconut-for-banana style mismatches.
    const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 4);
    for (const cand of shuffled) {
      const isAbs = /^https?:\/\//i.test(cand.image || '');
      const imageUrl = isAbs ? cand.image : `${baseUrl}/${cand.image}`;
      const c = await critiqueImage({
        subject: cand.word,
        imageUrl,
        photoDescription: cand.caption,
      });
      if (passesGate(c, GATES.throwback)) {
        if (c) console.log(`Throwback PASS: ${cand.date} ${cand.word} (score=${c.score}, subj%=${c.subjectPercentEstimate})`);
        return cand;
      }
      console.log(`Throwback REJECT: ${cand.date} ${cand.word} (score=${c?.score}, subj%=${c?.subjectPercentEstimate}, "${c?.photoSubject}"). Trying next.`);
    }
    console.log('Throwback: all 4 candidates failed critic. Falling back to most recent entry.');
    return entries[0];
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
  'Look at that.',
  "Don't tell us it isn't thiccc.",
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

// 2026-07-23: engagement-ask pool for the afternoon fallback template, mirroring
// the "MUST end with an explicit engagement ask" rule added to the primary
// AI-generated caption path in generate-daily.js. Same deadpan register, no
// hype-speak ("comment below!" etc.) -- this only fires on days the AI
// caption step errors out and post-to-buffer.js falls back to templates.
const ENGAGEMENT_ASKS = [
  'Rate the thicccness, 1 to 10.',
  "Thicccer than yesterday's entry, or not. Your call.",
  'File your objection below, if you have one.',
  'A 10 is rare. Convince us this is one.',
];

function pickEngagementAsk(entry) {
  const seed = (entry.date || '') + ':engagement';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return ENGAGEMENT_ASKS[Math.abs(h) % ENGAGEMENT_ASKS.length];
}

// Observation-voice templates with punchline pool. Each variant pairs entry
// data (example/definition) with a brand-voice aside so the caption itself
// does comedy work regardless of how dry the entry data happens to be.
//
// Wave 89: Bespoke caption preferred when `entry.socialCaptions[mode]` is set.
// Hand-written (or LLM-generated at entry-gen time, see QUEUED-FOLLOWUPS) per
// entry so the caption references real specifics about THAT subject instead of
// a universal one-liner. Falls back to template below if absent.
async function buildText(entry, mode, baseUrl) {
  const entryUrl = `${baseUrl}/entries/${entry.date}.html`;
  // Wave 117: pick byline. Reels are always Hugh. Non-reels weighted random with ~20% unsigned.
  const byline = mode === 'reels' ? { id: 'hugh', display: 'Hugh' } : pickSocialByline();
  const sig = byline.display ? `\n\n${byline.display}` : '';

  // Wave 127: if byline is signed and mode is a daily post, try Claude voice-rewrite first.
  if (byline.id && byline.id !== 'hugh' && ['morning', 'afternoon', 'evening'].includes(mode)) {
    const rewrite = await rewriteInBylineVoice(entry, byline, mode, baseUrl);
    if (rewrite) {
      console.log(`[buildText] voice-rewrote in ${byline.display}'s voice`);
      const cta = `\n\nSpotted a thiccc thing? → ${baseUrl}/submit.html`;
      const suffix = `${cta}\n\n${entryUrl}\n\n#thiccctionary`;
      return fitToX('', rewrite, suffix);
    }
    console.log('[buildText] voice-rewrite failed, falling back to template + signature');
  }

  // Wave 89: bespoke caption path.
  const bespoke = entry.socialCaptions && typeof entry.socialCaptions[mode] === 'string'
    ? entry.socialCaptions[mode].trim()
    : '';
  if (bespoke) {
    if (mode === 'reels') {
      return `${bespoke}${sig}\n\nFull entry on thiccctionary.com\n\n#thiccctionary #wordoftheday`;
    }
    const cta = `\n\nSpotted a thiccc thing? → ${baseUrl}/submit.html`;
    const suffix = `${cta}\n\n${entryUrl}\n\n#thiccctionary`;
    return fitToX('', bespoke + sig, suffix);
  }

  // Fallback path: Wave 86/87 templated captions.
  const def0 = stripHtml(entry.definitions[0]);
  const example = stripHtml(entry.example || '').replace(/^"|"$/g, '').trim();
  const punch = pickPunchline(entry, mode);

  if (mode === 'afternoon') {
    // Example + punchline + word tag + engagement ask (2026-07-23: mirrors
    // the AI-generated caption path's mandatory engagement close).
    const body = example || def0;
    const ask = pickEngagementAsk(entry);
    const suffix = `\n\n${punch}\n\nThat's ${entry.word.toLowerCase()}. ${ask}\n${entryUrl}\n\n#thiccctionary`;
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
    // 2026-07-23: was "Full entry on thiccctionary.com" -- a plain-text URL
    // Reels/TikTok don't render as a link, so it wasted caption space for a
    // dead click. Reels are the actual reach asset (per docs/SOCIAL-STRATEGY.md);
    // the CTA should point somewhere with a reason to come back daily, not a
    // static entry page. New round of the site's own daily guessing game
    // fits that, phrased as the standard "link in bio" Reels convention.
    const lead = example || def0;
    return `${lead}\n\n${punch}\n\n${entry.word}.${sig}\n\nNew round of Guess the Thiccc, every day. Link in bio.\n\n#thiccctionary #wordoftheday`;
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
    const suffix = `\n\n${entry.word}, today on Thiccctionary\u2122.\n${baseUrl}\n\n#thiccctionary`;
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
    // Wave 280: SKIP_INSTAGRAM=true posts the reel to FB only. Used when
    // re-firing a reel whose IG copy already published (e.g. FB-side media
    // failure) so IG doesn't get a duplicate.
    if (process.env.SKIP_INSTAGRAM === 'true') {
      const ig = new Set(['instagram', 'instagrambusiness']);
      filtered = filtered.filter(c => !ig.has(c.service));
      console.log('SKIP_INSTAGRAM=true, reel goes to FB only.');
    }
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
  if (!['morning', 'afternoon', 'evening', 'reels', 'article', 'office'].includes(mode)) {
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

  // ---- office mode: pull latest queued staff post (Wave 118) ----
  if (mode === 'office') {
    const queuePath = path.join(ROOT, 'data', 'office-post-queue.json');
    let queue;
    try {
      queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
    } catch (e) {
      console.log('No office-post-queue.json or unreadable. Skipping.');
      return;
    }
    const next = queue.find(p => p.status === 'queued');
    if (!next) {
      console.log('No queued office posts. Skipping.');
      return;
    }
    console.log(`Selected office post: ${next.id} (byline=${next.byline_id}, score=${next.score})`);
    const text = next.text;
    console.log(`--- Post text ---\n${text}\n---`);

    const allChannels = process.env.BUFFER_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const idx = s.indexOf(':');
      if (idx === -1) return { service: null, channelId: s };
      return { service: s.slice(0, idx).toLowerCase(), channelId: s.slice(idx + 1) };
    });
    // Wave 208c: office mode goes to text-first platforms only (X, Threads).
    // Christopher 2026-05-24: FB office posts are inside-joke saturated and
    // text-only (FB algorithm buries them). Office voice works on X/Threads
    // where dry deadpan reads better; FB gets only entry-driven image posts.
    const channels = allChannels.filter(c => c.service !== 'instagram' && c.service !== 'facebook');
    if (channels.length === 0) {
      console.log('No non-Instagram channels configured for office post.');
      return;
    }

    const results = await Promise.all(
      channels.map(({ channelId, service }) =>
        postToChannelWithRetry({ channelId, text, imageUrl: null, videoUrl: null, thumbnailUrl: null, token: process.env.BUFFER_ACCESS_TOKEN, service, mode: 'office' })
      )
    );
    let successes = 0, failures = 0;
    for (const r of results) {
      if (r.ok) { successes++; console.log(`OK channel ${r.channelId} (post id: ${r.postId})`); }
      else { failures++; console.error(`FAIL channel ${r.channelId}: ${r.error || 'unknown'}`); }
    }
    next.status = failures > 0 && successes === 0 ? 'failed' : 'posted';
    next.posted_at = new Date().toISOString();
    next.success_count = successes;
    next.failure_count = failures;
    next.errors = results.filter(r => !r.ok).map(r => ({ channelId: r.channelId, status: r.status, body: (r.body || '').slice(0, 500) }));
    await fs.writeFile(queuePath, JSON.stringify(queue, null, 2) + '\n', 'utf8');
    console.log(`Office post posted: ${successes} succeeded, ${failures} failed.`);
    return;
  }


  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  if (entries.length === 0) {
    console.log('No entries found.');
    return;
  }
  const entry = await pickEntry(entries, mode, process.env.SITE_BASE_URL.replace(/\/$/, ''));
  console.log(`Selected entry: ${entry.date} -- "${entry.word}"`);

  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
  // Wave 79: entry.image may be relative ('images/2026-05-10.jpg') OR an
  // absolute URL (submission entries store the R2 public URL directly).
  // Don't double-prefix absolute URLs.
  const isAbsolute = /^https?:\/\//i.test(entry.image || '');
  const imageUrl = isAbsolute ? entry.image : `${baseUrl}/${entry.image}`;
  // Wave 284: REEL_VIDEO_BASE lets a re-fire serve the MP4 from an alternate
  // host (e.g. jsDelivr over the repo). Diagnostic for FB's "media URL is
  // unreachable" rejections: files are spec-compliant (H.264/AAC 44.1k/faststart)
  // and browser-reachable, so the remaining suspect is Meta's fetcher being
  // challenged on the primary host. IG untouched (it publishes fine either way).
  // Wave 306 (2026-07-18): DEFAULT host is now jsDelivr-over-the-repo, not the
  // site. PROVEN root cause of every FB reel failure Jul 11-18: Facebook's
  // media fetcher cannot retrieve MP4s from thiccctionary.com (Cloudflare
  // challenges Meta's crawler), while the identical file served from jsDelivr
  // published successfully (fb.com/reel/3295757830631080, 2026-07-18). Files
  // are on main before any reels step runs, so @main always resolves.
  const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/christopherlhicks29-create/thiccctionary@main';
  const videoBase = (process.env.REEL_VIDEO_BASE || JSDELIVR_BASE).replace(/\/$/, '');
  const videoUrl = mode === 'reels' ? `${videoBase}/videos/${entry.date}.mp4` : null;
  const thumbnailUrl = mode === 'reels' ? imageUrl : null;

  // Wave 208 Layer B: pre-post critic for all image-bearing modes. Evening was
  // already gated by pickEntry's throwback gate; this catches the other modes.
  // If image fails the gate, we SKIP the post (exit 0) rather than hard-fail,
  // since the entry already shipped to the site and one missed social slot
  // beats a wrong-image social slot.
  if (['morning', 'afternoon', 'reels'].includes(mode) && entry.image) {
    try {
      const c = await critiqueImage({
        subject: entry.word,
        imageUrl,
        photoDescription: entry.caption,
      });
      if (!passesGate(c, GATES.throwback)) {
        console.log(`[critic-gate] skipping ${mode} post for ${entry.date} ${entry.word}: image fails subject-prominence test (score=${c?.score}, subj%=${c?.subjectPercentEstimate}, "${c?.photoSubject}").`);
        // Append to remediation queue so admin sees it
        try {
          const remPath = path.join(ROOT, 'data', 'social-remediation-queue.json');
          let rq = { remediation: [] };
          try { rq = JSON.parse(await fs.readFile(remPath, 'utf8')); } catch {}
          if (!Array.isArray(rq.remediation)) rq.remediation = [];
          rq.remediation.push({
            action: 'regen-image',
            target: entry.date,
            reason: `Critic rejected at ${mode} post time: ${c?.photoSubject || 'unknown subject'}`,
            suggested_at: new Date().toISOString(),
          });
          await fs.writeFile(remPath, JSON.stringify(rq, null, 2));
        } catch {}
        process.exit(0);
      }
      if (c) console.log(`[critic-gate] ${mode} ${entry.date}: PASS (score=${c.score}, subj%=${c.subjectPercentEstimate})`);
    } catch (e) {
      console.warn(`[critic-gate] errored (non-blocking): ${e.message}`);
    }
  }

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

  const text = await buildText(entry, mode, baseUrl);

  // Wave 207: dedup gate. If the EXACT same text was posted in the last 48h
  // (per audits/buffer-posts/), skip this post instead of pushing a duplicate.
  // The Transformer "No transformation arc" Reel was queued twice on the same
  // day in May 2026 because of a retry race. This gate prevents that pattern.
  try {
    const fsSync = await import('node:fs');
    const auditDir = path.join(ROOT, 'audits', 'buffer-posts');
    if (fsSync.existsSync(auditDir)) {
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      const files = fsSync.readdirSync(auditDir);
      for (const f of files) {
        try {
          const stat = fsSync.statSync(path.join(auditDir, f));
          if (stat.mtimeMs < cutoff) continue;
          const data = JSON.parse(fsSync.readFileSync(path.join(auditDir, f), 'utf8'));
          for (const modeRec of Object.values(data || {})) {
            const prior = (modeRec && modeRec.text) || '';
            if (prior && prior.trim() === text.trim()) {
              console.log(`[dedup] same caption was already posted (${f}). Skipping to avoid duplicate.`);
              process.exit(0);
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.warn(`[dedup] check errored (non-blocking): ${e.message}`);
  }

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

  // Wave 202: write per-channel results to audits/buffer-posts/<date>.json
  // so the admin dashboard can render per-platform status pills on the
  // Today's Reel tile without needing Buffer API access.
  try {
    const resultsPath = path.join(ROOT, 'audits', 'buffer-posts', entry.date + '.json');
    await fs.mkdir(path.dirname(resultsPath), { recursive: true });
    let existing = {};
    try { existing = JSON.parse(await fs.readFile(resultsPath, 'utf8')); } catch (e) { existing = {}; }
    existing[mode] = {
      ts: new Date().toISOString(),
      successes,
      failures,
      channels: results.map(r => {
        const ch = channels.find(c => c.channelId === r.channelId) || {};
        return {
          service: ch.service || 'unknown',
          channelId: r.channelId,
          status: r.ok ? 'posted' : 'failed',
          postId: r.postId || null,
          error: r.ok ? null : (r.body || '').slice(0, 200),
        };
      }),
    };
    await fs.writeFile(resultsPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
    console.log('Wrote results to audits/buffer-posts/' + entry.date + '.json');
  } catch (e) {
    console.warn('Could not write buffer-posts log (non-fatal): ' + e.message);
  }

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
