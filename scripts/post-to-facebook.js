/**
 * Direct Facebook Page posting via Graph API — replaces Buffer for FB
 * specifically. Removes the "Published by Buffer" attribution; Meta will
 * attribute posts to the registered Facebook App name (so register the app
 * as "Thiccctionary" in Meta dev console).
 *
 * Buffer continues to handle IG and X — only FB gets the direct treatment.
 *
 * Required env vars:
 *   FB_PAGE_ACCESS_TOKEN   — long-lived Page Access Token (NOT a User token).
 *                            From Meta Developer Console → Tools → Graph API
 *                            Explorer → request token with
 *                            pages_manage_posts + pages_read_engagement, then
 *                            exchange for a long-lived token.
 *   FB_PAGE_ID             — numeric Page ID (visible in About → Page ID, or
 *                            graph.facebook.com/me/accounts after auth)
 *   SITE_BASE_URL          — e.g. https://thiccctionary.com
 *   POST_MODE              — Optional. morning | afternoon | evening | article.
 *                            Default: morning.
 *
 * The script REUSES post-to-buffer.js's text-builder logic so the FB post
 * matches what Buffer would have sent for that mode — same hashtags,
 * same hook templates, same X-character cap.
 *
 * Exit codes:
 *   0 — success
 *   0 — secrets missing (logs and exits cleanly so the workflow can chain
 *       to Buffer-with-FB-included as a fallback during the setup window)
 *   1 — Graph API call failed
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const GRAPH_API_VERSION = 'v21.0';

// ----- Text builders (mirrored from post-to-buffer.js) ----------------------

const stripHtml = s => (s || '').replace(/<[^>]+>/g, '');

const X_LIMIT = 280;  // Same limit Buffer enforces; keeps content portable.
function fitToX(prefix, body, suffix) {
  const overhead = prefix.length + suffix.length;
  const room = X_LIMIT - overhead;
  if (body.length <= room) return prefix + body + suffix;
  return prefix + body.slice(0, Math.max(0, room - 1)).trimEnd() + '…' + suffix;
}

function pickEntry(entries, mode) {
  if (mode === 'evening') {
    const candidates = entries.slice(2);
    if (candidates.length === 0) return entries[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return entries[0];
}

function buildText(entry, mode, baseUrl) {
  const entryUrl = `${baseUrl}/entries/${entry.date}.html`;
  if (mode === 'afternoon') {
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
  // morning (default) — same 4-variant rotation as post-to-buffer.js
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const variant = dayOfYear % 4;
  const def0 = stripHtml(entry.definitions[0]);
  const example = stripHtml(entry.example || '').replace(/^"|"$/g, '');

  if (variant === 0) {
    const prefix = `📖 ${entry.word}\n\n`;
    const suffix = `\n\nToday's entry → ${baseUrl}\n\n#wordoftheday #etymology #satire`;
    return fitToX(prefix, def0, suffix);
  }
  if (variant === 1) {
    const prefix = `Use it in a sentence —\n\n"`;
    const body = example || def0;
    const suffix = `"\n\n— ${entry.word}, today on Thiccctionary\n${baseUrl}\n\n#wordoftheday #etymology`;
    return fitToX(prefix, body, suffix);
  }
  if (variant === 2) {
    const ety = stripHtml(entry.etymology || '');
    const prefix = `📚 ${entry.word}\n\nEtymology: `;
    const suffix = `\n\nFull entry → ${baseUrl}\n\n#etymology #wordoftheday`;
    if (ety) return fitToX(prefix, ety, suffix);
    return fitToX(`📖 ${entry.word}\n\n`, def0, `\n\nToday's entry → ${baseUrl}\n\n#wordoftheday`);
  }
  const prefix = `Today: ${entry.word}\n\n`;
  const suffix = `\n\nthiccctionary.com\n\n#satire #etymology #wordoftheday`;
  return fitToX(prefix, def0, suffix);
}

// ----- Article-mode text builder -------------------------------------------

function buildArticleText(article, baseUrl) {
  const articleUrl = `${baseUrl}/articles/${article.slug}.html`;
  const prefix = `📚 An article from Thiccctionary —\n\n${article.title}\n\n`;
  const body = article.description || '';
  const suffix = `\n\nRead → ${articleUrl}\n\n#thiccctionary #satire`;
  return fitToX(prefix, body, suffix);
}

// ----- Graph API caller ----------------------------------------------------

async function postPhoto({ pageId, token, imageUrl, caption }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`;
  const params = new URLSearchParams({
    url: imageUrl,
    caption: caption,
    access_token: token,
    published: 'true'
  });
  const res = await fetch(url, {
    method: 'POST',
    body: params
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    return { ok: false, status: res.status, error: json.error || json };
  }
  return { ok: true, postId: json.post_id || json.id };
}

// ----- Main -----------------------------------------------------------------

async function main() {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;

  if (!token || !pageId) {
    console.log('FB direct posting not configured (missing FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID).');
    console.log('Skipping. The Buffer FB channel will still post (fallback).');
    process.exit(0);  // exit clean — workflow continues, Buffer still fires
  }

  if (!process.env.SITE_BASE_URL) {
    console.error('SITE_BASE_URL not set.');
    process.exit(1);
  }

  const mode = (process.env.POST_MODE || 'morning').toLowerCase();
  if (!['morning', 'afternoon', 'evening', 'article'].includes(mode)) {
    console.error(`Unsupported POST_MODE for FB direct: "${mode}". (Reels are still routed through Buffer.)`);
    process.exit(1);
  }
  console.log(`FB direct mode: ${mode}`);

  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');

  let imageUrl;
  let text;

  if (mode === 'article') {
    const articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8'));
    if (articles.length === 0) {
      console.log('No articles available.');
      return;
    }
    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const weekOfYear = Math.ceil((dayOfYear + 1) / 7);
    const article = articles[weekOfYear % articles.length];
    console.log(`Selected article: ${article.slug} — "${article.title}"`);
    imageUrl = `${baseUrl}/articles/og/${article.slug}.png`;
    text = buildArticleText(article, baseUrl);
  } else {
    const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
    if (entries.length === 0) {
      console.log('No entries available.');
      return;
    }
    const entry = pickEntry(entries, mode);
    console.log(`Selected entry: ${entry.date} — "${entry.word}"`);
    imageUrl = `${baseUrl}/${String(entry.image).replace(/^\.?\//, '')}`;
    text = buildText(entry, mode, baseUrl);
  }

  console.log(`FB direct: posting to page ${pageId}`);
  console.log(`  image: ${imageUrl}`);
  console.log(`  text:\n${text}\n  ---`);

  const result = await postPhoto({ pageId, token, imageUrl, caption: text });
  if (result.ok) {
    console.log(`OK — FB post id: ${result.postId}`);
  } else {
    console.error(`FAIL — status=${result.status} error=${JSON.stringify(result.error).slice(0, 500)}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
