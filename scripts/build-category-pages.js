/**
 * Wave 304: category landing pages. SEO audit item #9.
 *
 * Every entry carries a `category` field and nothing has ever used it. The
 * site's only topical grouping is the tag cloud at /tags/, which links to
 * /archive.html?tag=X -- a client-side filter over one HTML document. A query
 * parameter that reorders a JS-rendered list is not a page: those URLs have
 * never been indexable, so this site has had ~300 pages and zero topical hubs.
 *
 * What this builds
 *   /category/                     an index of the nine categories
 *   /category/<slug>/              one landing page per category
 *
 * An honest note on what this is worth. These pages are not going to rank for
 * anything competitive; "thiccc vehicles" has no meaningful search demand.
 * The value is site architecture: nine crawlable hubs that group 105 entries
 * by subject, give every entry a second inbound internal link from a topical
 * parent, and cut the click depth from the homepage to a mid-archive entry.
 * That is a real but modest win, and it is worth being clear about that rather
 * than pretending it is a keyword play.
 *
 * The one thing that would make these thin -- nine near-identical pages with a
 * templated paragraph swapping in the category name -- is avoided by writing a
 * genuine intro for each. See CATEGORIES below. A category with fewer than
 * MIN_ENTRIES entries is skipped rather than shipped half-empty.
 *
 * Usage: node scripts/build-category-pages.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, escapeHtml, stripHtml, head, page } from './lib/chrome.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'category');
const MIN_ENTRIES = 3;

// slug, page title lead, meta description, and a hand-written intro. The intro
// is the whole reason these pages are not thin, so it is written per category
// and not generated.
export const CATEGORIES = {
  'Produce & Botanical': {
    slug: 'produce',
    heading: 'Produce & Botanical',
    title: 'Thiccc Produce and Botanical Specimens',
    description: 'Catalogued gourds, tubers, fruit and other growing things of unusual girth, from the Thiccctionary.',
    intro: `The vegetable kingdom does the least work for the most result. A gourd spends one summer doing nothing in particular and arrives at a mass no engineered object reaches without a budget and a permit. This is the largest section of the catalogue and it is not close, which the editors attribute less to editorial bias than to the simple fact that things which grow are under no obligation to stop.`,
  },
  'Industrial Machinery': {
    slug: 'industrial-machinery',
    heading: 'Industrial Machinery',
    title: 'Thiccc Industrial Machinery: Rollers and Presses',
    description: 'Rollers, presses, excavators and boring machines catalogued for girth rather than tonnage, from the Thiccctionary.',
    intro: `Industrial equipment is the section where the editorial standard is tested hardest, because industry produces a great many objects that are merely heavy. Heavy is not thiccc. A crane is enormous and almost entirely absent. What qualifies here is the machine whose working mass sits in one continuous body: the drum, the flywheel, the cutting head. Tonnage is a specification. Girth is a silhouette.`,
  },
  'Architecture & Infrastructure': {
    slug: 'architecture',
    heading: 'Architecture & Infrastructure',
    title: 'Thiccc Architecture and Infrastructure',
    description: 'Columns, dams, bridges and load-bearing structures catalogued for girth, from the Thiccctionary.',
    intro: `Architecture is the only discipline in the catalogue where girth is a deliberate decision rather than an accident of growth or a consequence of function. Somebody sat down, calculated a load, and then specified a column considerably fatter than the calculation required, because a building that looks like it might fall down is a building nobody enters. These entries are girth as reassurance.`,
  },
  'Domestic Goods': {
    slug: 'domestic-goods',
    heading: 'Domestic Goods',
    title: 'Thiccc Domestic Goods: Oversized Household Objects',
    description: 'Armchairs, mugs, cookware and other household objects catalogued for girth, from the Thiccctionary.',
    intro: `The domestic section is where the reader is most likely to encounter a catalogued subject in person, which imposes a discipline the rest of the archive escapes. Nobody will check our figure for a tunnel boring machine. Everybody owns a mug. An object earns its place here by being wider than its function strictly demands and by having been chosen, deliberately, on that basis.`,
  },
  'Foods of Substance': {
    slug: 'foods',
    heading: 'Foods of Substance',
    title: 'Thiccc Foods: Edible Subjects of Unusual Girth',
    description: 'Prepared foods catalogued for structural girth rather than calorie count, from the Thiccctionary.',
    intro: `Prepared food is the most contested category in the archive and the subject of a standing internal objection, which the reader may consult in the essay on the problem of edible thiccc. The difficulty is that food is designed to be consumed, and an object in the process of being eaten is an object losing girth. The editors have ruled that the catalogued state is the served state. The ruling is not universally accepted at this masthead.`,
  },
  'Vehicles & Transport': {
    slug: 'vehicles',
    heading: 'Vehicles & Transport',
    title: 'Thiccc Vehicles: Transport Catalogued for Girth',
    description: 'Ships, haulers, mixers and other vehicles catalogued for beam and girth, from the Thiccctionary.',
    intro: `A vehicle has to move, and moving punishes width more than any other property. Everything in this section is therefore an argument that was won: some engineer made the case that the payload, the drum, or the hull mattered more than the drag, and was believed. The cement mixer is the pure form of this and remains the section's founding subject.`,
  },
  'Musical Instruments': {
    slug: 'musical-instruments',
    heading: 'Musical Instruments',
    title: 'Thiccc Musical Instruments: Resonating Bodies',
    description: 'Double basses, tubas, kettledrums and other instruments catalogued for the girth of the resonating body, from the Thiccctionary.',
    intro: `Instruments are the only objects in the catalogue where girth is functionally load-bearing on the output. A larger body moves more air and produces a lower note; the width is the sound. This is the one section where the editors can point at a subject and say the girth is doing something audible, which is more than can be said for most of the archive.`,
  },
  'Engineering Marvels': {
    slug: 'engineering-marvels',
    heading: 'Engineering Marvels',
    title: 'Thiccc Engineering: Built Wider Than Necessary',
    description: 'Singular engineering works catalogued for girth, from the Thiccctionary.',
    intro: `A small section, deliberately. "Marvel" is a word the editors distrust and admit sparingly. What lands here are the one-off works that do not sit comfortably in machinery or infrastructure: singular objects, built once, at a scale that made the width a headline rather than a footnote.`,
  },
  'Natural Specimens': {
    slug: 'natural-specimens',
    heading: 'Natural Specimens',
    title: 'Thiccc Natural Specimens: Girth Without Design',
    description: 'Naturally occurring subjects catalogued for girth, from the Thiccctionary.',
    intro: `Nothing in this section was designed, budgeted, or specified. These subjects arrived at their proportions without a meeting. The editors find this section restful for that reason and note that it contains, per entry, the least controversy of any category in the archive.`,
  },
};

/**
 * Wave 305: the rendered <title> is `${cat.title} · Thiccctionary`, and that
 * suffix is 16 characters that are easy to forget when writing a title that
 * looks fine on its own. Four of the nine categories shipped over the 70-char
 * budget on day one and the weekly health audit is what caught it.
 *
 * Fail the build instead. A category page is worth having only for search, so
 * a category page with a truncated SERP title is most of the way to pointless,
 * and this is cheaper to fix at the moment someone adds the tenth category
 * than a week later in an audit nobody reads.
 */
const TITLE_SUFFIX = ' · Thiccctionary';
const TITLE_BUDGET = 70;
for (const [name, cat] of Object.entries(CATEGORIES)) {
  const full = cat.title + TITLE_SUFFIX;
  if (full.length > TITLE_BUDGET) {
    throw new Error(
      `[categories] title for "${name}" renders ${full.length} chars, budget is ${TITLE_BUDGET}: ` +
      `"${full}". Shorten CATEGORIES["${name}"].title by ${full.length - TITLE_BUDGET}.`
    );
  }
}

function trimDef(s, max = 150) {
  const t = stripHtml(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const w = t.slice(0, max);
  const stop = Math.max(w.lastIndexOf('. '), w.lastIndexOf('? '), w.lastIndexOf('! '));
  if (stop > max * 0.5) return w.slice(0, stop + 1).trim();
  return w.replace(/\s\S*$/, '').replace(/[\s,;:]+$/, '') + '…';
}

const CARD_CSS = `.cat-grid { list-style: none; padding: 0; margin: 32px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 22px; }
.cat-card { margin: 0; border: 1px solid var(--rule); border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.35); transition: border-color 0.15s; }
.cat-card:hover { border-color: var(--oxblood); }
.cat-card a { display: block; color: inherit; text-decoration: none; }
.cat-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: var(--cream-deep); }
.cat-card-body { padding: 14px 16px 18px; }
.cat-card-word { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; line-height: 1.2; margin: 0 0 6px; }
.cat-card-def { font-size: 0.92rem; line-height: 1.5; color: var(--ink-soft); margin: 0; }
.cat-card-date { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--oxblood); display: block; margin-top: 10px; }
.cat-nav { display: flex; flex-wrap: wrap; gap: 10px; margin: 34px 0 8px; padding: 0; list-style: none; }
.cat-nav a { display: inline-block; padding: 7px 14px; border: 1px solid var(--rule); border-radius: 999px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; color: var(--ink-soft); }
.cat-nav a:hover, .cat-nav a[aria-current] { border-color: var(--oxblood); color: var(--oxblood); }
.cat-lede { max-width: 46rem; font-size: 1.06rem; line-height: 1.65; }
.cat-count { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 18px; }`;

function catNav(all, currentSlug) {
  return `<ul class="cat-nav">
  <li><a href="/category/"${!currentSlug ? ' aria-current="page"' : ''}>All categories</a></li>
${all.map(c => `  <li><a href="/category/${c.slug}/"${c.slug === currentSlug ? ' aria-current="page"' : ''}>${escapeHtml(c.heading)}</a></li>`).join('\n')}
</ul>`;
}

function card(e) {
  const word = stripHtml(e.word || '').trim();
  const img = String(e.image || '').replace(/^\.?\//, '');
  const alt = stripHtml(e.caption || '').replace(/\s+/g, ' ').trim()
    .replace(/^Plate\s+[^.]{1,10}\.,?\s*/i, '') || `${word}, catalogued as thiccc`;
  return `  <li class="cat-card">
    <a href="/entries/${e.date}.html">
      ${img ? `<img src="/${escapeHtml(img)}" alt="${escapeHtml(alt.slice(0, 125))}" loading="lazy" width="800" height="600" />` : ''}
      <div class="cat-card-body">
        <p class="cat-card-word">${escapeHtml(word)}</p>
        <p class="cat-card-def">${escapeHtml(trimDef(e.definitions?.[0]))}</p>
        <span class="cat-card-date">${e.date}</span>
      </div>
    </a>
  </li>`;
}

function renderCategory(cat, entries, all) {
  const canonical = `${SITE}/category/${cat.slug}/`;
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonical,
    url: canonical,
    name: cat.title,
    description: cat.description,
    isPartOf: { '@id': `${SITE}/#website` },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Thiccctionary', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Categories', item: `${SITE}/category/` },
        { '@type': 'ListItem', position: 3, name: cat.heading, item: canonical },
      ],
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: sorted.length,
      itemListElement: sorted.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/entries/${e.date}.html`,
        name: stripHtml(e.word),
      })),
    },
  }];

  const bodyHtml = `  <p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; margin: 18px 0 0;"><a href="/category/">&larr; All categories</a></p>
  <h1 class="headword" style="font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; margin: 14px 0 8px;">${escapeHtml(cat.heading)}</h1>
  <p class="cat-count">${sorted.length} catalogued ${sorted.length === 1 ? 'entry' : 'entries'}</p>
  <p class="cat-lede">${cat.intro}</p>
${catNav(all, cat.slug)}
  <ul class="cat-grid">
${sorted.map(card).join('\n')}
  </ul>
  <p style="text-align: center; margin: 48px 0 32px;">
    <a href="/archive.html">Browse the full dated archive &rarr;</a> &middot;
    <a href="/a-z.html">Look one up A&ndash;Z &rarr;</a>
  </p>`;

  return page({
    headHtml: head({
      title: `${cat.title} · Thiccctionary`,
      description: cat.description,
      canonical,
      ogTitle: cat.title,
      image: sorted[0]?.image ? `${SITE}/${String(sorted[0].image).replace(/^\.?\//, '')}` : undefined,
      extraCss: CARD_CSS,
      jsonLd,
    }),
    bodyHtml,
    mastheadOpts: { left: 'Categories', right: cat.heading },
  });
}

function renderIndex(all, counts) {
  const canonical = `${SITE}/category/`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonical,
    url: canonical,
    name: 'Categories · Thiccctionary',
    description: `Every Thiccctionary entry grouped by subject: ${all.map(c => c.heading).join(', ')}.`,
    isPartOf: { '@id': `${SITE}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: all.length,
      itemListElement: all.map((c, i) => ({
        '@type': 'ListItem', position: i + 1,
        url: `${SITE}/category/${c.slug}/`, name: c.heading,
      })),
    },
  }];

  const rows = all.map(c => `  <li class="cat-card">
    <a href="/category/${c.slug}/">
      <div class="cat-card-body">
        <p class="cat-card-word">${escapeHtml(c.heading)}</p>
        <p class="cat-card-def">${escapeHtml(trimDef(c.description, 130))}</p>
        <span class="cat-card-date">${counts[c.slug]} ${counts[c.slug] === 1 ? 'entry' : 'entries'}</span>
      </div>
    </a>
  </li>`).join('\n');

  const bodyHtml = `  <h1 class="headword" style="font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; margin: 24px 0 8px;">Categories</h1>
  <p class="cat-count">${total} entries, ${all.length} sections</p>
  <p class="cat-lede">The archive is chronological by default, which is useful for nobody except the archivist. This is the same catalogue arranged by what the subject actually is. A subject sits in exactly one section; where a ruling was close, the section it landed in is itself part of the ruling.</p>
  <ul class="cat-grid">
${rows}
  </ul>
  <p style="text-align: center; margin: 48px 0 32px;">
    <a href="/archive.html">Browse chronologically &rarr;</a> &middot;
    <a href="/a-z.html">A&ndash;Z index &rarr;</a> &middot;
    <a href="/tags/">Tag cloud &rarr;</a>
  </p>`;

  return page({
    headHtml: head({
      title: 'Categories · Every Thiccc Subject by Type · Thiccctionary',
      description: `Every Thiccctionary entry grouped by subject: produce, industrial machinery, architecture, domestic goods, foods, vehicles, instruments and more. ${total} catalogued entries.`,
      canonical,
      ogTitle: 'Categories · Every Thiccc Subject by Type',
      extraCss: CARD_CSS,
      jsonLd,
    }),
    bodyHtml,
    mastheadOpts: { left: 'Categories', right: `${all.length} Sections` },
  });
}

async function main() {
  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));

  const byCat = new Map();
  for (const e of entries) {
    const c = e.category;
    if (!c || !CATEGORIES[c]) continue;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(e);
  }

  const skipped = [];
  const live = [];
  const counts = {};
  for (const [name, cat] of Object.entries(CATEGORIES)) {
    const list = byCat.get(name) || [];
    if (list.length < MIN_ENTRIES) { skipped.push(`${name} (${list.length})`); continue; }
    live.push(cat);
    counts[cat.slug] = list.length;
  }
  live.sort((a, b) => counts[b.slug] - counts[a.slug]);

  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const cat of live) {
    const name = Object.keys(CATEGORIES).find(k => CATEGORIES[k] === cat);
    const dir = path.join(OUT_DIR, cat.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), renderCategory(cat, byCat.get(name), live), 'utf8');
  }
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), renderIndex(live, counts), 'utf8');

  const uncategorised = entries.filter(e => !e.category || !CATEGORIES[e.category]);
  console.log(`[category] wrote ${live.length} category pages + index (${Object.values(counts).reduce((a, b) => a + b, 0)} entries).`);
  if (skipped.length) console.log(`[category] skipped below ${MIN_ENTRIES}: ${skipped.join(', ')}`);
  if (uncategorised.length) {
    console.log(`[category] ${uncategorised.length} entr${uncategorised.length === 1 ? 'y is' : 'ies are'} not in any known category:`);
    for (const e of uncategorised) console.log(`  ${e.date}  ${stripHtml(e.word)}  (category: ${e.category || 'unset'})`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-category-pages.js')) {
  await main();
}
