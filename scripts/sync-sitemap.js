/**
 * Wave 303: keep sitemap.xml complete without anyone remembering to.
 *
 * Why this exists
 * ---------------
 * Four generators (entries, /is/ pages, images, daily) each poke at sitemap.xml
 * on their own terms, and nothing owned the article pages or the static pages.
 * The result: the newest Thiccc Beat column was absent from the sitemap the day
 * it shipped, and ~15 real pages (/about/documents/*, /cartoons/, /rate/,
 * /tags/, /follow/, /compare.html, /a-z.html, ...) had never been listed at all.
 *
 * Wave 303b: this is now the SINGLE OWNER of sitemap.xml. build-entry-pages.js
 * used to rewrite the file from scratch on every run from a hardcoded 20-page
 * list -- so the moment any of its four callers ran (generate-daily,
 * regenerate-images, regenerate-text, or the CLI) it silently reverted both of
 * the Wave 303 sitemap fixes: it re-added the 106 /is/ URLs that now canonical
 * to their parent entry, and it dropped the 13 static pages added here.
 * buildSitemap() is now a thin wrapper around syncSitemap().
 *
 * This is a single idempotent reconciler. It runs after content generation and
 * guarantees:
 *   - every entry in data/entries.json has a <url>
 *   - every article in data/articles.json has a <url>
 *   - every page on the STATIC allowlist has a <url>
 *   - nothing on the EXCLUDE list is present (admin tooling, generators,
 *     /404.html, /thanks.html, /random.html, the /is/ pages, and other
 *     non-indexable or canonicalised-away URLs)
 *
 * It never removes URLs it does not own, so anything hand-added to sitemap.xml
 * survives.
 *
 * Usage: node scripts/sync-sitemap.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');

// Real pages a stranger could land on. Anything not here and not an entry or
// article page is deliberately unlisted.
const STATIC = [
  ['/', '1.0'],
  ['/thiccc/', '0.9'],
  ['/archive.html', '0.8'],
  ['/a-z.html', '0.7'],
  ['/tags/', '0.6'],
  ['/articles/', '0.7'],
  ['/is-it-thiccc/', '0.7'],
  ['/about/', '0.6'],
  ['/about/masthead/', '0.5'],
  ['/about/style-guide/', '0.5'],
  ['/about/documents/', '0.5'],
  ['/cartoons/', '0.6'],
  ['/compare.html', '0.5'],
  ['/foreword-journal/', '0.5'],
  ['/follow/', '0.4'],
  ['/prints/', '0.5'],
  ['/rate/', '0.6'],
  ['/guess/', '0.6'],
  ['/submit.html', '0.5'],
  ['/embed/', '0.4'],
  ['/press/', '0.5'],
  ['/category/', '0.7'],
  ['/legal/terms.html', '0.3'],
  ['/legal/privacy.html', '0.3'],
];

// Utility / tooling / duplicate URLs that must never be advertised.
// The /is/<slug>-thiccc/ pages are excluded deliberately: as of Wave 303 they
// canonical to their parent entry, and listing a URL you are telling Google not
// to index is a contradiction that spends crawl budget on 106 of them. They
// stay live and linked from /is-it-thiccc/ for humans.
const EXCLUDE = [
  /\/404\.html$/,
  /\/thanks\.html$/,
  /\/random\.html$/,
  /\/admin\//,
  /\/api\//,
  /\/v\//,
  /-generator\.html$/,
  /\/embed\/today\.html$/,
  /\/is\/[^/]+-thiccc\/$/,
];

const SKELETON = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';

const urlBlock = (loc, priority, lastmod) =>
  `  <url>\n    <loc>${loc}</loc>\n` +
  (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
  `    <priority>${priority}</priority>\n  </url>`;

async function exists(p) {
  try { await fs.access(path.join(ROOT, p)); return true; } catch { return false; }
}

async function readJson(rel, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8')); }
  catch { return fallback; }
}

export async function syncSitemap({ check = false, quiet = false } = {}) {
  const smPath = path.join(ROOT, 'sitemap.xml');
  const log = (...a) => { if (!quiet) console.log(...a); };

  // Guard: a missing or structurally broken sitemap gets rebuilt from the
  // skeleton rather than throwing, since every generator now depends on this.
  let sm;
  try { sm = await fs.readFile(smPath, 'utf8'); } catch { sm = SKELETON; }
  if (!/<\/urlset>/i.test(sm)) sm = SKELETON;
  const before = sm;

  const present = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
  const added = [];
  const removed = [];

  // --- drop anything on the exclude list ------------------------------------
  sm = sm.replace(/\s*<url>(?:(?!<\/url>)[\s\S])*?<\/url>/g, (block) => {
    const m = block.match(/<loc>([^<]+)<\/loc>/);
    if (m && EXCLUDE.some(re => re.test(m[1]))) { removed.push(m[1]); return ''; }
    return block;
  });

  const additions = [];

  // --- static pages ---------------------------------------------------------
  for (const [route, priority] of STATIC) {
    const loc = `${SITE}${route}`;
    if (present.has(loc)) continue;
    // Only advertise a page that is actually on disk.
    const diskPath = route === '/' ? 'index.html'
      : route.endsWith('/') ? `${route.slice(1)}index.html`
      : route.slice(1);
    if (!(await exists(diskPath))) continue;
    additions.push(urlBlock(loc, priority));
    added.push(loc);
  }

  // --- daily entries --------------------------------------------------------
  // Wave 303b: previously owned by build-entry-pages.js buildSitemap().
  const entries = await readJson('data/entries.json', []);
  for (const e of entries) {
    if (!e || !e.date) continue;
    const loc = `${SITE}/entries/${e.date}.html`;
    if (present.has(loc)) continue;
    if (!(await exists(`entries/${e.date}.html`))) continue;
    additions.push(urlBlock(loc, '0.6', e.date));
    added.push(loc);
  }

  // --- category hubs --------------------------------------------------------
  // Wave 304b: discovered from disk rather than listed, so adding a category to
  // build-category-pages.js does not silently leave it out of the sitemap.
  let catDirs = [];
  try { catDirs = await fs.readdir(path.join(ROOT, 'category'), { withFileTypes: true }); } catch {}
  for (const d of catDirs) {
    if (!d.isDirectory()) continue;
    const loc = `${SITE}/category/${d.name}/`;
    if (present.has(loc)) continue;
    if (!(await exists(`category/${d.name}/index.html`))) continue;
    additions.push(urlBlock(loc, '0.6'));
    added.push(loc);
  }

  // --- articles -------------------------------------------------------------
  const articles = await readJson('data/articles.json', []);
  for (const a of articles) {
    if (!a || !a.slug) continue;
    const loc = `${SITE}/articles/${a.slug}.html`;
    if (present.has(loc)) continue;
    if (!(await exists(`articles/${a.slug}.html`))) continue;
    additions.push(urlBlock(loc, '0.6', a.date));
    added.push(loc);
  }

  if (additions.length) {
    sm = sm.replace(/<\/urlset>\s*$/i, additions.join('\n') + '\n</urlset>\n');
  }

  if (sm === before) {
    log('[sitemap] already in sync.');
    return { added: [], removed: [], changed: false };
  }

  if (!check) await fs.writeFile(smPath, sm, 'utf8');
  log(`[sitemap] ${check ? 'would add' : 'added'} ${added.length}, ${check ? 'would remove' : 'removed'} ${removed.length}`);
  for (const u of added) log(`  + ${u}`);
  for (const u of removed) log(`  - ${u}`);
  return { added, removed, changed: true };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('sync-sitemap.js')) {
  const check = process.argv.includes('--check');
  const res = await syncSitemap({ check });
  if (check && res.changed) process.exit(1);
}
