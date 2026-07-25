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
 * This is a single idempotent reconciler. It runs after content generation and
 * guarantees:
 *   - every article in data/articles.json has a <url>
 *   - every page on the STATIC allowlist has a <url>
 *   - nothing on the EXCLUDE list is present (admin tooling, generators,
 *     /404.html, /thanks.html, /random.html and other non-indexable utility URLs)
 *
 * It never removes URLs it does not own, so the entry and /is/ logic in the
 * other scripts keeps working untouched.
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
const CHECK_ONLY = process.argv.includes('--check');

// Real pages a stranger could land on. Anything not here and not an entry,
// article or /is/ page is deliberately unlisted.
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
];

// Utility / tooling / duplicate URLs that must never be advertised.
const EXCLUDE = [
  /\/404\.html$/,
  /\/thanks\.html$/,
  /\/random\.html$/,
  /\/admin\//,
  /\/api\//,
  /\/v\//,
  /-generator\.html$/,
  /\/embed\/today\.html$/,
];

const urlBlock = (loc, priority, lastmod) =>
  `  <url>\n    <loc>${loc}</loc>\n` +
  (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
  `    <priority>${priority}</priority>\n  </url>`;

async function exists(p) {
  try { await fs.access(path.join(ROOT, p)); return true; } catch { return false; }
}

async function main() {
  const smPath = path.join(ROOT, 'sitemap.xml');
  let sm = await fs.readFile(smPath, 'utf8');
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

  // --- static pages ---------------------------------------------------------
  const additions = [];
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

  // --- articles -------------------------------------------------------------
  const articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8'));
  for (const a of articles) {
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
    console.log('[sitemap] already in sync.');
    return;
  }

  if (!CHECK_ONLY) await fs.writeFile(smPath, sm, 'utf8');
  console.log(`[sitemap] ${CHECK_ONLY ? 'would add' : 'added'} ${added.length}, ${CHECK_ONLY ? 'would remove' : 'removed'} ${removed.length}`);
  for (const u of added) console.log(`  + ${u}`);
  for (const u of removed) console.log(`  - ${u}`);
  if (CHECK_ONLY) process.exit(1);
}

main().catch(err => { console.error('[sitemap] FATAL:', err); process.exit(1); });
