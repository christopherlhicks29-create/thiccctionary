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
import { syncSitemap } from './sync-sitemap.js';
import { CATEGORIES } from './build-category-pages.js';
import { ogDimsTags, ogCardUrl } from './lib/image-size.js'; // Wave 311: measure, don't type
import { toRomanNumeral, plateNumberFor, stripPlatePrefix } from './lib/plate.js'; // Wave 314: derive, don't type
import { faqsFor, faqPageNode, renderFaqSection, naturalName } from './lib/entry-faq.js'; // Wave 323/324: the query-shaped text belongs on the canonical page

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = process.env.SITE_BASE_URL || 'https://thiccctionary.com';

const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const TEMPLATE_PATH = path.join(ROOT, 'entries', '_template.html');
const OUT_DIR = path.join(ROOT, 'entries');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

// Wave 303: hard-sliced at 155 and appended an ellipsis, so descriptions ended
// mid-clause in the SERP ("...noted for its massive flukes and commanding…").
// Prefer the last complete sentence that fits; fall back to a word boundary.
function trimDescription(text, max = 155) {
  text = stripHtml(text).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (lastStop > max * 0.5) return window.slice(0, lastStop + 1).trim();
  return window.replace(/\s\S*$/, '').replace(/[\s,;:]+$/, '') + '\u2026';
}

// Wave 303: the meta description led with the definition and never named the
// thing being defined, so the SERP snippet for "stockless anchor" opened with
// "A substantial maritime device designed to..." with the term nowhere in it.
// Lead with the headword, the way a dictionary result should.
function entryDescription(entry) {
  // Wave 324: the natural order, not the catalogue inversion. This string is
  // the SERP snippet, and "Cactus, Saguaro: A towering succulent" opens on two
  // words in an order no reader has ever typed or spoken.
  const word = naturalName(stripHtml(entry.word || '').trim());
  const def = stripHtml(entry.definitions[0] || '').replace(/\s+/g, ' ').trim();
  if (!word) return trimDescription(def);
  const lead = `${word}: `;
  // Don't repeat the word if the definition already opens with it.
  if (def.toLowerCase().startsWith(word.toLowerCase())) return trimDescription(def);
  return lead + trimDescription(def, Math.max(60, 155 - lead.length));
}

// Wave 303: every entry image shipped alt="{{WORD}}" -- accurate but useless to
// image search and to a screen reader, since it describes nothing about the
// picture. The caption is a real description of the plate; reuse it, minus the
// "Plate IV." archival prefix which is site furniture, not image content.
function imageAltFor(entry) {
  // The plate prefix is site furniture, not image content, so it comes off for
  // alt text. The pattern used to be inlined here; it is lib/plate.js's now,
  // because the same prefix is parsed in four places and they must agree.
  const cap = stripPlatePrefix(stripHtml(entry.caption || '').replace(/\s+/g, ' ').trim());
  const word = stripHtml(entry.word || '').trim();
  if (cap.length >= 15) return cap.length > 125 ? cap.slice(0, 125).replace(/\s\S*$/, '') : cap;
  return word ? `${word}, catalogued as thiccc` : 'A thiccc subject';
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

// Wave 312: og:image and twitter:image now point at the composed card, not the
// raw photo. imageUrlForOg is kept for the JSON-LD "image" field, which should
// stay the photograph of the actual thing rather than a graphic with our
// wordmark on it -- Google reads that field as a depiction of the subject.
function cardUrlForOg(entry) {
  return ogCardUrl(entry, ROOT);
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

/**
 * Wave 304b: deterministic tiebreak.
 *
 * This used to break score ties with `Math.random() - 0.5` and shuffle the
 * fallback pool with `.sort(() => Math.random() - 0.5)`. Two problems:
 *
 *   1. Every pipeline run rewrote the "Related entries" block on all 105 entry
 *      pages, so the daily commit churned 115 files and nothing in the diff
 *      told you which change was real. It also meant a page's internal links
 *      changed under Google every single day for no editorial reason.
 *   2. `.sort()` with a comparator that is not consistent (a<b and b<a both
 *      true at random) is undefined behaviour in V8, not a shuffle.
 *
 * Replaced with a cheap FNV-1a hash of the pair of dates: still an arbitrary
 * spread across the archive rather than "always the three most recent", but
 * stable for a given entry, so the file only changes when the data changes.
 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function findRelatedEntries(entry, allEntries, limit = 3) {
  // Score other entries by shared tag count, return top N (shared >= 1).
  // Fall back to deterministically-spread other entries if no tag overlap.
  const myTags = new Set((entry.tags || []).map(normTag));
  const others = allEntries.filter(e => e.date !== entry.date);
  const seed = (e) => hash32(`${entry.date}:${e.date}`);
  if (myTags.size > 0) {
    const scored = others
      .map(e => {
        const theirTags = (e.tags || []).map(normTag);
        const shared = theirTags.filter(t => myTags.has(t)).length;
        return { entry: e, shared };
      })
      .filter(x => x.shared > 0)
      .sort((a, b) => b.shared - a.shared || seed(a.entry) - seed(b.entry));
    if (scored.length >= limit) return scored.slice(0, limit).map(x => x.entry);
    // Fewer than `limit` tag-matches, top them up from the rest of the archive.
    const taken = new Set(scored.map(x => x.entry.date));
    const fillers = others
      .filter(e => !taken.has(e.date))
      .sort((a, b) => seed(a) - seed(b))
      .slice(0, limit - scored.length);
    return [...scored.map(x => x.entry), ...fillers];
  }
  // No tags on the source entry.
  return others.slice().sort((a, b) => seed(a) - seed(b)).slice(0, limit);
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
function isSlugFor(word) {
  // Mirrors slugify() in scripts/build-is-pages.js.
  let primary = String(word).split(',')[0].trim().toLowerCase();
  primary = primary.replace(/^thiccc\s+/, '');
  return primary.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The Sources line cites the plate by number. It used to derive that number
// here, from `allEntries.length - i`, which is only correct while entries.json
// happens to be stored newest-first -- a storage detail, not a guarantee. Wave
// 314 moved the derivation to lib/plate.js, which sorts by date and therefore
// gives the same answer whatever order the file arrives in, and gives the same
// answer as the caption because the caption asks the same function.
function plateLabelFor(entry, allEntries) {
  const num = plateNumberFor(entry, allEntries);
  if (num) return `plate ${toRomanNumeral(num)}`;
  // Fallback: reuse the numeral already rendered into the caption.
  const m = typeof entry.caption === 'string' && entry.caption.match(/^Plate\s+([IVXLCDM]+)\.,?/);
  return m ? `plate ${m[1]}` : null;
}

function renderSources(entry, allEntries = null) {
  const items = [];

  // 1. Photo source. Real photographer + Unsplash link, reformatted as a citation.
  if (entry.photographer) {
    const url = entry.photographerUrl || 'https://unsplash.com/';
    const photoUrl = entry.unsplashUrl || url;
    const safeName = String(entry.photographer).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const plate = plateLabelFor(entry, allEntries);
    const plateNote = plate ? ` Catalogued under ${plate}.` : '';
    items.push(`Photograph by <a href="${url}" target="_blank" rel="noopener">${safeName}</a>, via <a href="${photoUrl}" target="_blank" rel="noopener">Unsplash</a>.${plateNote}`);
  }

  // 1b. Wave 190: direct link to the standalone "Is X thiccc?" ruling page.
  // Both citation-appropriate AND passes internal PageRank to the SEO landing.
  const slug = isSlugFor(entry.word);
  if (slug) {
    const subj = String(entry.word).split(',')[0].trim();
    items.push(`Direct ruling URL: <a href="../is/${slug}-thiccc/">thiccctionary.com/is/${slug}-thiccc/</a> &mdash; the shareable "Is ${/^[aeiouAEIOU]/.test(subj) ? 'an' : 'a'} ${String(subj).toLowerCase()} thiccc?" page.`);
  }

  // 2. A-Z cross-reference - real internal link to the alphabetical archive.
  const firstLetter = String(entry.word || '').charAt(0).toUpperCase();
  if (/[A-Z]/.test(firstLetter)) {
    items.push(`Cross-reference: <a href="../a-z.html#${firstLetter}">Thiccctionary A-Z, ${firstLetter}</a>.`);
  }

  // 3. Category lineage. Wave 304b: this used to be a dead <em>. Now it links
  // to the category hub, which is the entry's only inbound link from a topical
  // parent and the only thing that makes those hubs worth having.
  if (entry.category) {
    const label = String(entry.category).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const slug = CATEGORIES[entry.category]?.slug;
    items.push(slug
      ? `Catalogued under: <a href="../category/${slug}/">${label}</a>. See related entries below.`
      : `Catalogued under: <em>${label}</em>. See related entries below.`);
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
  const description = entryDescription(entry);

  // Wave 323. The /is/<slug>-thiccc/ page carries the "Is a kettlebell thiccc?"
  // text and canonicals here, and is not in the sitemap, so the question a
  // reader actually types was on the one page the site asks Google to ignore.
  // It ships here now, on the page the canonical points at.
  const faqs = faqsFor(entry);

  // Build schema.org JSON-LD for this entry: DefinedTerm + Article + BreadcrumbList + FAQPage
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
      },
      faqPageNode(faqs, canonical + "#faq")
    ]
  }, null, 2);

  const replacements = {
    JSONLD: jsonld,
    WORD: escapeHtml(entry.word),
    WORD_HTML: escapeHtml(entry.word), // ccc highlighter runs client-side
    // Wave 324. The headword stays inverted everywhere a reader sees it, because
    // the inversion is the joke and the H1 is where the joke lives. The <title>
    // is not a place a reader looks first, it is the strongest ranking signal on
    // the page and the line that shows in the SERP, and on 106 pages it read
    // "Cactus, Saguaro" -- a string with no search demand in any language.
    TITLE_NAME: escapeHtml(naturalName(entry.word)),
    WORD_ENC: encodeURIComponent(entry.word),
    TWEET_TEXT: encodeURIComponent(`📖 ${entry.word}, today on @thiccctionary\n\n#wordoftheday #etymology #thiccctionary`),
    PRONUNCIATION: escapeHtml(entry.pronunciation || ''),
    POS: escapeHtml(entry.partOfSpeech || 'n.'),
    DEF_1: entry.definitions[0],
    DEF_2_BLOCK: def2Block,
    EXAMPLE: entry.example || '',
    ETYMOLOGY: entry.etymology || '',
    IMAGE: imageUrlForPage(entry),
    IMAGE_WEBP: imageUrlForPage(entry).replace(/\.jpg$/i, '.webp'),
    OG_IMAGE: cardUrlForOg(entry),
    OG_IMAGE_ENC: encodeURIComponent(cardUrlForOg(entry)),
    // Wave 311: measured from the image, not typed. Entry photos are 1080x1140,
    // not the 1200x630 the template used to claim for every one of them.
    OG_IMAGE_DIMS: ogDimsTags(cardUrlForOg(entry), ROOT),
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
    IMAGE_ALT: escapeHtml(imageAltFor(entry)),
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
    FAQ_HTML: renderFaqSection(faqs),
    SOURCES_HTML: renderSources(entry, allEntries),
    RELATED_ENTRIES: renderRelated(allEntries ? findRelatedEntries(entry, allEntries, 3) : []),
  };

  let html = template;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }

  // Bug fix (2026-07-24): the template's own documentation block (the "Tokens
  // (replaced by scripts/generate-daily.js...)" comment) was being emitted into
  // every published page -- 2.3 KB of internal scaffolding on all 106 entries,
  // ~8% of each page's bytes, with the entry's definition and example repeated
  // inside it. Strip it from the built output; it stays in _template.html where
  // it is actually useful.
  html = html.replace(/^(<!DOCTYPE html>\s*)<!--[\s\S]*?-->\s*/i, '$1');

  const outPath = path.join(OUT_DIR, `${entry.date}.html`);
  await fs.writeFile(outPath, html);
  return outPath;
}

/**
 * Wave 303b: this used to rewrite sitemap.xml from scratch on every call, from
 * a hardcoded 20-page staticPages array plus a locally-computed list of all 106
 * /is/ URLs. Four scripts call it (generate-daily, regenerate-images,
 * regenerate-text, and the CLI below), so any one of them silently reverted the
 * Wave 303 sitemap work: it re-added the /is/ pages that now canonical to their
 * parent entry, and dropped the 13 static pages the reconciler had added.
 *
 * scripts/sync-sitemap.js is now the single owner. This stays exported so the
 * three callers keep working; the `entries` argument is ignored because the
 * reconciler reads data/entries.json itself.
 */
export async function buildSitemap(_entries) {
  await syncSitemap({ quiet: true });
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
