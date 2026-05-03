/**
 * Builds per-entry HTML pages from data/entries.json + entries/_template.html.
 *
 * Usage:
 *   node scripts/build-entry-pages.js              # rebuild all entry pages
 *   node scripts/build-entry-pages.js 2026-05-01   # rebuild a single date
 *
 * Also called by generate-daily.js to render the new entry's page.
 *
 * Also rewrites sitemap.xml with one URL per entry plus the static pages.
 */

import fs from 'node:fs/promises';
import { buildRssFeed } from './build-rss.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = process.env.SITE_BASE_URL || 'https://thiccctionary.com';

const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const TEMPLATE_PATH = path.join(ROOT, 'entries', '_template.html');
const OUT_DIR = path.join(ROOT, 'entries');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

function trimDescription(text, max = 155) {
  text = stripHtml(text).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s\S*$/, '') + '…';
}

function humanDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function imageUrlForOg(entry) {
  // entry.image is "images/foo.jpg" — normalize to absolute URL
  const path = entry.image.replace(/^\.?\//, '');
  return `${SITE.replace(/\/$/, '')}/${path}`;
}

function imageUrlForPage(entry) {
  // Page lives in /entries/ so go up one level
  return `../${entry.image.replace(/^\.?\//, '')}`;
}

function renderTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

function renderCredit(entry) {
  if (!entry.photographer) return '';
  const utm = '?utm_source=thiccctionary&utm_medium=referral';
  const photogUrl = entry.photographerUrl ? entry.photographerUrl + utm : '#';
  return `Photo by <a href="${escapeHtml(photogUrl)}" target="_blank" rel="noopener">${escapeHtml(entry.photographer)}</a> on <a href="https://unsplash.com/${utm}" target="_blank" rel="noopener">Unsplash</a>`;
}

export async function buildEntryPage(entry) {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const canonical = `${SITE.replace(/\/$/, '')}/entries/${entry.date}.html`;
  const def2Block = entry.definitions[1]
    ? `<li><strong>2.</strong> ${entry.definitions[1]}</li>`
    : '';
  const description = trimDescription(entry.definitions[0]);

  // Build schema.org JSON-LD for this entry: DefinedTerm + Article
  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTerm",
        "@id": canonical + "#term",
        "name": entry.word,
        "description": stripHtml(entry.definitions[0]),
        "inDefinedTermSet": {
          "@type": "DefinedTermSet",
          "@id": "https://thiccctionary.com/#dictionary",
          "name": "Thiccctionary",
          "url": "https://thiccctionary.com/"
        }
      },
      {
        "@type": "Article",
        "@id": canonical + "#article",
        "url": canonical,
        "headline": entry.word + " — Thiccctionary",
        "name": entry.word,
        "description": description,
        "image": imageUrlForOg(entry),
        "datePublished": entry.date,
        "dateModified": entry.date,
        "inLanguage": "en-US",
        "isPartOf": { "@id": "https://thiccctionary.com/#website" },
        "publisher": { "@id": "https://thiccctionary.com/#organization" },
        "mainEntity": { "@id": canonical + "#term" },
        "keywords": (entry.tags || []).join(", "),
        "author": entry.photographer ? {
          "@type": "Organization",
          "@id": "https://thiccctionary.com/#organization",
          "name": "Thiccctionary"
        } : undefined
      }
    ]
  }, null, 2);

  const replacements = {
    JSONLD: jsonld,
    WORD: escapeHtml(entry.word),
    WORD_HTML: escapeHtml(entry.word), // ccc highlighter runs client-side
    WORD_ENC: encodeURIComponent(entry.word),
    PRONUNCIATION: escapeHtml(entry.pronunciation || ''),
    POS: escapeHtml(entry.partOfSpeech || 'n.'),
    DEF_1: entry.definitions[0],
    DEF_2_BLOCK: def2Block,
    EXAMPLE: entry.example || '',
    ETYMOLOGY: entry.etymology || '',
    IMAGE: imageUrlForPage(entry),
    OG_IMAGE: imageUrlForOg(entry),
    CAPTION: escapeHtml(entry.caption || ''),
    CREDIT_HTML: renderCredit(entry),
    TAGS_HTML: renderTags(entry.tags),
    DATE: entry.date,
    DATE_HUMAN: humanDate(entry.date),
    CANONICAL: canonical,
    CANONICAL_ENC: encodeURIComponent(canonical),
    DESCRIPTION: escapeHtml(description),
  };

  let html = template;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }

  const outPath = path.join(OUT_DIR, `${entry.date}.html`);
  await fs.writeFile(outPath, html);
  return outPath;
}

export async function buildSitemap(entries) {
  const base = SITE.replace(/\/$/, '');
  const staticPages = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/archive.html`, priority: '0.8' },
    { loc: `${base}/articles/`, priority: '0.7' },
    { loc: `${base}/articles/the-five-thicccest-things.html`, priority: '0.7', lastmod: '2026-05-02' },
    { loc: `${base}/submit.html`, priority: '0.5' },
  ];
  const entryPages = entries.map(e => ({
    loc: `${base}/entries/${e.date}.html`,
    lastmod: e.date,
    priority: '0.6',
  }));

  const all = [...staticPages, ...entryPages];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(p => `  <url>
    <loc>${p.loc}</loc>
${p.lastmod ? `    <lastmod>${p.lastmod}</lastmod>\n` : ''}    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  await fs.writeFile(SITEMAP_PATH, xml);
}

// CLI mode
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('build-entry-pages.js')) {
  const raw = await fs.readFile(ENTRIES_PATH, 'utf8');
  const entries = JSON.parse(raw);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const filterDate = process.argv[2];
  const targets = filterDate ? entries.filter(e => e.date === filterDate) : entries;

  for (const entry of targets) {
    const out = await buildEntryPage(entry);
    console.log(`Built ${path.relative(ROOT, out)}`);
  }

  await buildSitemap(entries);
  await buildRssFeed(entries);
  console.log(`Wrote feed.xml with ${entries.length} entries.`);
  console.log(`Updated sitemap.xml with ${entries.length} entries.`);
}
