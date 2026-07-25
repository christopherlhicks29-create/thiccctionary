/**
 * Generates feed.xml (RSS 2.0) at the site root from data/entries.json + data/articles.json.
 * Daily entries are interleaved with long-form articles, sorted by date desc.
 * Called by generate-daily.js after each new entry is added.
 *
 * Run standalone: SITE_BASE_URL=https://thiccctionary.com node scripts/build-rss.js
 */

import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');

const escapeXml = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '');

function rfc822(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toUTCString();
}

// Wave 303: enclosures shipped with length="0", which is invalid RSS -- some
// aggregators drop the enclosure outright. Resolve the real byte size off
// disk. Also guards the disambiguation race: if the daily pipeline renamed
// the image after entries.json was written (e.g. slug collision adds a -4l9c
// suffix), the declared path won't exist, and we fall back to the default
// rather than shipping a 404 into the feed.
function enclosureFor(relPath) {
  const rel = String(relPath || '').replace(/^\.?\//, '');
  const fallback = { url: `${SITE}/og-default.png`, type: 'image/png', length: 0 };
  if (!rel) return fallback;
  let size = 0;
  try {
    size = statSync(path.join(ROOT, rel)).size;
  } catch {
    console.warn(`[rss] image not on disk, falling back to og-default: ${rel}`);
    return fallback;
  }
  const ext = path.extname(rel).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { url: `${SITE}/${rel}`, type, length: size };
}

function entryItem(e) {
  const url = `${SITE}/entries/${e.date}.html`;
  const desc = stripHtml(e.definitions[0]);
  const enc = enclosureFor(e.image);
  const tags = (e.tags || []).map(t => `<category>${escapeXml(t)}</category>`).join('');
  return `    <item>
      <title>${escapeXml(e.word)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(e.date)}</pubDate>
      <description>${escapeXml(desc)}</description>
      <enclosure url="${enc.url}" type="${enc.type}" length="${enc.length}" />
      ${tags}
    </item>`;
}

function articleItem(a) {
  const url = `${SITE}/articles/${a.slug}.html`;
  return `    <item>
      <title>[Article] ${escapeXml(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(a.date)}</pubDate>
      <description>${escapeXml(a.description)}</description>
      <category>article</category>
    </item>`;
}

export async function buildRssFeed(entries, articles = []) {
  // Build a unified, date-sorted item list (entries + articles).
  const all = [
    ...entries.map(e => ({ kind: 'entry', date: e.date, render: () => entryItem(e) })),
    ...articles.map(a => ({ kind: 'article', date: a.date, render: () => articleItem(a) })),
  ];
  all.sort((a, b) => b.date.localeCompare(a.date));
  const items = all.map(x => x.render()).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Thiccctionary</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>A satirical daily dictionary of objects of unusual girth. Strictly things, never people.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Thiccctionary build pipeline</generator>
    <image>
      <url>${SITE}/og-default.png</url>
      <title>Thiccctionary</title>
      <link>${SITE}/</link>
    </image>
${items}
  </channel>
</rss>
`;

  const outPath = path.join(ROOT, 'feed.xml');
  await fs.writeFile(outPath, xml);

  // ---- Per-tag feeds ------------------------------------------------------
  // Generate a /feed/<tag>.xml for any tag that appears in 2+ entries.
  // Lets serious followers subscribe to e.g. only the vehicle entries.
  await buildTagFeeds(entries);

  return outPath;
}

async function buildTagFeeds(entries) {
  const feedsDir = path.join(ROOT, 'feed');
  await fs.mkdir(feedsDir, { recursive: true });

  // Tally tags
  const counts = new Map();
  for (const e of entries) {
    for (const t of (e.tags || [])) {
      const k = String(t).toLowerCase().trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  // Filter to tags that appear in >= 2 entries
  const eligible = [...counts.entries()].filter(([, n]) => n >= 2).map(([t]) => t);

  // Also delete stale feeds (tags that no longer qualify)
  try {
    const existing = await fs.readdir(feedsDir);
    for (const f of existing) {
      if (f.endsWith('.xml')) {
        const tag = f.slice(0, -4);
        if (!eligible.includes(tag)) {
          await fs.unlink(path.join(feedsDir, f));
        }
      }
    }
  } catch (e) {}

  for (const tag of eligible) {
    const matching = entries.filter(e => (e.tags || []).map(t => String(t).toLowerCase().trim()).includes(tag));
    matching.sort((a, b) => b.date.localeCompare(a.date));
    const items = matching.map(entryItem).join('\n');
    const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Thiccctionary, ${escapeXml(tagLabel)}</title>
    <link>${SITE}/archive.html?tag=${encodeURIComponent(tag)}</link>
    <atom:link href="${SITE}/feed/${tag}.xml" rel="self" type="application/rss+xml" />
    <description>Thiccctionary entries tagged "${escapeXml(tag)}".</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
    await fs.writeFile(path.join(feedsDir, `${tag}.xml`), xml);
  }

  console.log(`Per-tag feeds: ${eligible.length} written (tags with 2+ entries)`);
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  const articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8').catch(() => '[]'));
  const out = await buildRssFeed(entries, articles);
  console.log(`Wrote ${out} with ${entries.length} entries + ${articles.length} articles.`);
}
