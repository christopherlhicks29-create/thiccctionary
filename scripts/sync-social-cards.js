#!/usr/bin/env node
/**
 * sync-social-cards.js - Wave 316
 *
 * A live sweep of all 202 sitemap URLs found four pages declaring no og:image
 * at all, and /embed/ declaring no Open Graph tags of any kind. Those pages
 * share as a bare blue link: no picture, no title beyond the URL, nothing to
 * click. /embed/ is the page that asks other sites to embed us, so it is
 * exactly the page most likely to be pasted into someone else's Slack.
 *
 * Nothing here is authored. A page already states its own title, its own
 * description and its own canonical URL; the share card is those three facts
 * plus an image, and the only new one is the image, which falls back to the
 * site default when the page has no picture of its own. So this fills in what
 * is missing and leaves alone what is already there -- it will not overwrite a
 * card a generator wrote.
 *
 * Scope is the sitemap, deliberately. Three hundred HTML files live in this
 * tree and most of them -- 404, generators, templates -- are not meant to be
 * shared. The sitemap is the site's own list of pages it wants strangers to
 * land on, so it is the right definition of "should have a share card."
 *
 * Idempotent. Run before sync-og-dimensions.js, which measures whatever image
 * this leaves behind.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const DEFAULT_IMAGE = `${SITE}/og-default.png`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function diskPathFor(loc) {
  if (!loc.startsWith(SITE)) return null;
  const route = loc.slice(SITE.length) || '/';
  if (route === '/') return 'index.html';
  return route.endsWith('/') ? `${route.slice(1)}index.html` : route.slice(1);
}

const has = (html, prop) =>
  new RegExp(`<meta\\s+(?:property|name)="${prop}"`, 'i').test(html);

const grab = (html, re) => {
  const m = html.match(re);
  return m ? m[1].trim() : null;
};

let sitemap;
try { sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); }
catch { console.log('[social] no sitemap.xml; nothing to do.'); process.exit(0); }

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let fixed = 0, already = 0, missing = 0;
const notes = [];

for (const loc of locs) {
  const rel = diskPathFor(loc);
  const file = rel && path.join(ROOT, rel);
  if (!file || !fs.existsSync(file)) { missing++; continue; }

  const html = fs.readFileSync(file, 'utf8');
  if (!/<\/head>/i.test(html)) { missing++; continue; }

  // What the page already says about itself.
  const title = grab(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i)
    || grab(html, /<title>([^<]*)<\/title>/i);
  const desc = grab(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i)
    || grab(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
  const image = grab(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i)
    || DEFAULT_IMAGE;

  const add = [];
  if (!has(html, 'og:type')) add.push('<meta property="og:type" content="website" />');
  if (!has(html, 'og:url')) add.push(`<meta property="og:url" content="${esc(loc)}" />`);
  if (!has(html, 'og:title') && title) add.push(`<meta property="og:title" content="${esc(title)}" />`);
  if (!has(html, 'og:description') && desc) add.push(`<meta property="og:description" content="${esc(desc)}" />`);
  // Dimensions are left to sync-og-dimensions.js, which reads the file's bytes.
  // Typing 1200x630 here would be the exact mistake that script exists to undo.
  if (!has(html, 'og:image')) add.push(`<meta property="og:image" content="${esc(image)}" />`);
  if (!has(html, 'twitter:card')) add.push('<meta name="twitter:card" content="summary_large_image" />');
  if (!has(html, 'twitter:title') && title) add.push(`<meta name="twitter:title" content="${esc(title)}" />`);
  if (!has(html, 'twitter:description') && desc) add.push(`<meta name="twitter:description" content="${esc(desc)}" />`);
  if (!has(html, 'twitter:image')) add.push(`<meta name="twitter:image" content="${esc(image)}" />`);

  if (!add.length) { already++; continue; }

  fs.writeFileSync(file, html.replace(/<\/head>/i, `${add.join('\n')}\n</head>`));
  notes.push(`  ${rel}: +${add.length} tag(s)`);
  fixed++;
}

for (const n of notes.slice(0, 12)) console.log(n);
if (notes.length > 12) console.log(`  ...and ${notes.length - 12} more.`);
console.log(fixed === 0
  ? `[social] ${already} page(s), all already carry a complete share card.${missing ? ` ${missing} not on disk.` : ''}`
  : `[social] ${fixed} page(s) completed, ${already} already correct.${missing ? ` ${missing} not on disk.` : ''}`);
