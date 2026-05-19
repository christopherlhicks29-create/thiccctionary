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
  // entry.image is "images/foo.jpg", normalize to absolute URL
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
  const isUnsplash = !!(entry.unsplashUrl && entry.unsplashUrl.includes('unsplash.com'));
  // Unsplash credit format requires linking back to Unsplash with photographer + the source.
  if (isUnsplash) {
    const photogUrl = entry.photographerUrl ? entry.photographerUrl + utm : '#';
    return `Photo by <a href="${escapeHtml(photogUrl)}" target="_blank" rel="noopener">${escapeHtml(entry.photographer)}</a> on <a href="https://unsplash.com/${utm}" target="_blank" rel="noopener">Unsplash</a>`;
  }
  // Editor-captured or user-submitted: just show the photographer name (and link if provided),
  // no Unsplash backlink (would be inaccurate).
  if (entry.photographerUrl) {
    return `Photo by <a href="${escapeHtml(entry.photographerUrl)}" target="_blank" rel="noopener">${escapeHtml(entry.photographer)}</a>`;
  }
  return `Photo by ${escapeHtml(entry.photographer)}`;
}

// Normalize tags so related-entry matches catch obvious variants
// (botany ↔ botanical, agriculture ↔ agricultural, vehicle ↔ vehicles, etc.)
const TAG_ALIASES = {
  'botanical': 'botany',
  'agricultural': 'agriculture',
  'vehicles': 'vehicle',
  'fruits': 'fruit',
  'vegetables': 'vegetable',
  'gourds': 'botany',
  'produce': 'agriculture',
  'horticulture': 'botany',
  'competitive horticulture': 'botany',
  'gastronomy': 'agriculture',
  'kitchen': 'appliance',
  'refrigeration': 'appliance',
  'aviation': 'aircraft',
  'tail-heavy': 'aircraft',
  'heavy-duty': 'vehicle',
  'truck': 'vehicle',
  'industrial': 'machinery',
  'construction': 'machinery',
  'upholstery': 'furniture',
  'opulence': 'furniture',
};
function normTag(t) {
  if (!t) return '';
  const k = String(t).trim().toLowerCase();
  return TAG_ALIASES[k] || k;
}

function findRelatedEntries(entry, allEntries, limit = 3) {
  // Score other entries by shared tag count, return top N (shared >= 1).
  // Fall back to random recent entries if no tag overlap exists.
  const myTags = new Set((entry.tags || []).map(normTag));
  const others = allEntries.filter(e => e.date !== entry.date);
  if (myTags.size > 0) {
    const scored = others
      .map(e => {
        const theirTags = (e.tags || []).map(normTag);
        const shared = theirTags.filter(t => myTags.has(t)).length;
        return { entry: e, shared };
      })
      .filter(x => x.shared > 0)
      .sort((a, b) => b.shared - a.shared || Math.random() - 0.5);
    if (scored.length >= limit) return scored.slice(0, limit).map(x => x.entry);
    // Fewer than `limit` tag-matches, top them up with random other entries.
    const taken = new Set(scored.map(x => x.entry.date));
    const fillers = others
      .filter(e => !taken.has(e.date))
      .sort(() => Math.random() - 0.5)
      .slice(0, limit - scored.length);
    return [...scored.map(x => x.entry), ...fillers];
  }
  // No tags on the source entry, pick random recent.
  return others.sort(() => Math.random() - 0.5).slice(0, limit);
}

function renderRelated(related) {
  if (!related || related.length === 0) return '';
  const items = related.map(e => {
    const word = String(e.word).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const def = String(e.definitions[0] || '').replace(/<[^>]+>/g, '').slice(0, 110).trim();
    return `    <a class="related-card" href="${e.date}.html">
      <span class="related-word">${word}</span>
      <span class="related-snip">${def.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}…</span>
    </a>`;
  }).join('\n');
  return `  <!-- Related-by-tag entries -->
  <section class="related-entries" aria-label="More like this">
    <h3 class="related-heading">More like this</h3>
    <div class="related-grid">
${items}
    </div>
  </section>`;
}

// Wave 166: Sources / editorial citations footer. Deadpan absurdist
// academic register. Pulls photographer attribution + a plausible
// internal cross-reference + an editorial-board citation that lands as
// a joke on a first-time reader without requiring any inside knowledge.
function renderSources(entry, allEntries = null) {
  const items = [];

  // 1. Photo source. Real photographer + Unsplash link, reformatted as a citation.
  if (entry.photographer) {
    const url = entry.photographerUrl || 'https://unsplash.com/';
    const photoUrl = entry.unsplashUrl || url;
    const safeName = String(entry.photographer).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    items.push(`Photograph by <a href="${url}" target="_blank" rel="noopener">${safeName}</a>, via <a href="${photoUrl}" target="_blank" rel="noopener">Unsplash</a>. Catalogued under plate N.`);
  }

  // 2. A-Z cross-reference - real internal link to the alphabetical archive.
  const firstLetter = String(entry.word || '').charAt(0).toUpperCase();
  if (/[A-Z]/.test(firstLetter)) {
    items.push(`Cross-reference: <a href="../a-z.html#${firstLetter}">Thiccctionary A-Z, ${firstLetter}</a>.`);
  }

  // 3. Category lineage. Real internal link if the entry has a category.
  if (entry.category) {
    items.push(`Catalogued under: <em>${String(entry.category).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</em>. See related entries below.`);
  }

  // 4. Editorial review line. Deadpan joke that lands without needing
  // to know who the Senior Cataloguer is - "pending objection" reads as
  // standard academic-dictionary footnote language.
  items.push(`Editorial review: pending objection from the Senior Cataloguer's office.`);

  if (items.length === 0) return '';

  return `  <section class="entry-sources" aria-label="Sources and editorial notes" style="margin: 56px 0 0; padding: 28px 24px; border-top: 1px solid var(--rule); font-size: 14px; line-height: 1.6;">
    <h3 style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 1rem; font-weight: 600;">Sources</h3>
    <ol style="margin: 0; padding-left: 1.5rem; color: var(--ink-soft);">
${items.map(i => `      <li style="margin-bottom: 0.5rem;">${i}</li>`).join('\n')}
    </ol>
  </section>`;
}

export async function buildEntryPage(entry, prev = null, next = null, allEntries = null) {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const canonical = `${SITE.replace(/\/$/, '')}/entries/${entry.date}.html`;
  const def2Block = entry.definitions[1]
    ? `<li><strong>2.</strong> ${entry.definitions[1]}</li>`
    : '';
  const description = trimDescription(entry.definitions[0]);

  // Build schema.org JSON-LD for this entry: DefinedTerm + Article + BreadcrumbList
  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://thiccctionary.com/" },
          { "@type": "ListItem", "position": 2, "name": "Archive", "item": "https://thiccctionary.com/archive.html" },
          { "@type": "ListItem", "position": 3, "name": entry.word, "item": canonical }
        ]
      },
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
        "headline": entry.word + ", Thiccctionary",
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
    TWEET_TEXT: encodeURIComponent(`📖 ${entry.word}, today on @thiccctionary\n\n#wordoftheday #etymology #thiccctionary`),
    PRONUNCIATION: escapeHtml(entry.pronunciation || ''),
    POS: escapeHtml(entry.partOfSpeech || 'n.'),
    DEF_1: entry.definitions[0],
    DEF_2_BLOCK: def2Block,
    EXAMPLE: entry.example || '',
    ETYMOLOGY: entry.etymology || '',
    IMAGE: imageUrlForPage(entry),
    OG_IMAGE: imageUrlForOg(entry),
    OG_IMAGE_ENC: encodeURIComponent(imageUrlForOg(entry)),
    PIN_TEXT: (() => {
      const def = stripHtml(entry.definitions[0]);
      let trimmed = def;
      if (def.length > 200) {
        trimmed = def.slice(0, 200);
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace > 100) trimmed = trimmed.slice(0, lastSpace);
        trimmed += '…';
      }
      return encodeURIComponent(`${entry.word}, a Thiccctionary entry. ${trimmed}`);
    })(),
    PIN_TEXT_PLAIN: (() => {
      // Same description, but as escaped plain text (for HTML attribute, NOT URL-encoded)
      const def = stripHtml(entry.definitions[0]);
      let trimmed = def;
      if (def.length > 200) {
        trimmed = def.slice(0, 200);
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace > 100) trimmed = trimmed.slice(0, lastSpace);
        trimmed += '…';
      }
      return escapeHtml(`${entry.word}, a Thiccctionary entry. ${trimmed}`);
    })(),
    CAPTION: escapeHtml(entry.caption || ''),
    CREDIT_HTML: renderCredit(entry),
    TAGS_HTML: renderTags(entry.tags),
    DATE: entry.date,
    DATE_HUMAN: humanDate(entry.date),
    CANONICAL: canonical,
    CANONICAL_ENC: encodeURIComponent(canonical),
    DESCRIPTION: escapeHtml(description),
    PREV_NAV: prev
      ? `<a class="entry-nav-link entry-nav-link--prev" href="${prev.date}.html"><span class="entry-nav-direction">← Previous entry</span><span class="entry-nav-word">${escapeHtml(prev.word)}</span></a>`
      : `<span class="entry-nav-link entry-nav-link--placeholder"></span>`,
    NEXT_NAV: next
      ? `<a class="entry-nav-link entry-nav-link--next" href="${next.date}.html"><span class="entry-nav-direction">Next entry →</span><span class="entry-nav-word">${escapeHtml(next.word)}</span></a>`
      : `<span class="entry-nav-link entry-nav-link--placeholder"></span>`,
    SOURCES_HTML: renderSources(entry, allEntries),
    RELATED_ENTRIES: renderRelated(allEntries ? findRelatedEntries(entry, allEntries, 3) : []),
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
    { loc: `${base}/thiccc/`, priority: '0.9', lastmod: '2026-05-09' },
    { loc: `${base}/archive.html`, priority: '0.8' },
    { loc: `${base}/articles/`, priority: '0.7' },
    { loc: `${base}/articles/the-five-thicccest-things.html`, priority: '0.7', lastmod: '2026-05-02' },
    { loc: `${base}/articles/what-counts-as-thiccc.html`, priority: '0.7', lastmod: '2026-05-02' },
    { loc: `${base}/articles/history-of-thiccc.html`, priority: '0.7', lastmod: '2026-05-02' },
    { loc: `${base}/articles/field-guide-spotting-thiccc.html`, priority: '0.7', lastmod: '2026-05-03' },
    { loc: `${base}/articles/cement-trucks-original-thiccc.html`, priority: '0.7', lastmod: '2026-05-03' },
    { loc: `${base}/articles/industrial-scale-thiccc.html`, priority: '0.7', lastmod: '2026-05-04' },
    { loc: `${base}/articles/taxonomy-thiccc-architecture.html`, priority: '0.7', lastmod: '2026-05-04' },
    { loc: `${base}/articles/everyday-sidewalk-thiccc.html`, priority: '0.7', lastmod: '2026-05-04' },
    { loc: `${base}/articles/concrete-material-study.html`, priority: '0.7', lastmod: '2026-05-05' },
    { loc: `${base}/articles/anatomy-thiccc-vehicle.html`, priority: '0.7', lastmod: '2026-05-05' },
    { loc: `${base}/legal/terms.html`, priority: '0.3' },
    { loc: `${base}/legal/privacy.html`, priority: '0.3' },
    { loc: `${base}/press/`, priority: '0.5' },
    { loc: `${base}/submit.html`, priority: '0.5' },
    { loc: `${base}/embed/`, priority: '0.4' },
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
if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('build-entry-pages.js'))) {
  const raw = await fs.readFile(ENTRIES_PATH, 'utf8');
  const entries = JSON.parse(raw);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const filterDate = process.argv[2];
  const targets = filterDate ? entries.filter(e => e.date === filterDate) : entries;

  // Compute prev/next per entry. entries.json is sorted newest-first;
  // "next" in chronological terms = entries[i-1] (newer), "prev" = entries[i+1] (older).
  const indexByDate = new Map(entries.map((e, i) => [e.date, i]));
  for (const entry of targets) {
    const i = indexByDate.get(entry.date);
    const next = i > 0 ? entries[i - 1] : null;
    const prev = i < entries.length - 1 ? entries[i + 1] : null;
    const out = await buildEntryPage(entry, prev, next, entries);
    console.log(`Built ${path.relative(ROOT, out)}`);
  }

  await buildSitemap(entries);
  const articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8').catch(() => '[]'));
  await buildRssFeed(entries, articles);
  console.log(`Wrote feed.xml with ${entries.length} entries.`);
  console.log(`Updated sitemap.xml with ${entries.length} entries.`);
}
