#!/usr/bin/env node
/**
 * sync-subscribe.js - Wave 317
 *
 * The mailing list is the only audience this site actually owns. Every other
 * channel is rented: a search ranking, a feed algorithm, a platform that
 * changes its mind. So the one question worth asking of any page is whether a
 * stranger who liked it can say so.
 *
 * 88 of the 201 pages in the sitemap had no way to subscribe. Among them: all
 * 51 articles. Articles are the long-form surface, the pages that rank, the
 * pages a link points at -- the pages a stranger is most likely to arrive on
 * cold, and the ones with no capture at all. Also every category hub, every
 * archive index, /guess/, /rate/, /is-it-thiccc/: the three pages a reader has
 * just spent two minutes playing with, at the exact moment they liked it most.
 *
 * The entry template has had a well-designed conversion block since Wave 60-odd
 * and it never left the entry template. Its classes live in styles.css, not
 * inline, so the block works anywhere. Nothing needed designing; it needed
 * putting on the other pages.
 *
 * Insert-only, like sync-footer-links.js: a page that already carries a
 * subscribe form is left exactly as it is, so the entry pages' own block, with
 * its entry-specific copy, is never touched or duplicated. Root-absolute hrefs,
 * because these pages live at four different directory depths and the entry
 * block's "../feed.xml" is only correct from one of them.
 *
 * Scope is the sitemap: the site's own list of pages it wants strangers on.
 *
 * Usage: node scripts/sync-subscribe.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const CHECK = process.argv.includes('--check');

// The one string that identifies a subscribe form anywhere on the site. If a
// page contains it, in any markup, this script leaves the page alone.
const MARKER = 'embed-subscribe/thiccctionary';

const BLOCK = `
  <!-- Wave 317: conversion CTA. Inserted by scripts/sync-subscribe.js. -->
  <section class="entry-subscribe">
    <p class="entry-subscribe-eyebrow">Get the daily entry in your inbox.</p>
    <form class="entry-subscribe-form" action="https://buttondown.email/api/emails/${MARKER}" method="post">
      <input type="email" name="email" placeholder="your@email.com" required aria-label="Email address" />
      <button type="submit">Subscribe</button>
    </form>
    <p class="entry-subscribe-alt">Or follow on <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram</a> &middot; <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook</a> &middot; <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X</a> &middot; <a href="/feed.xml">RSS</a></p>
  </section>
`;

function diskPathFor(loc) {
  if (!loc.startsWith(SITE)) return null;
  const route = loc.slice(SITE.length) || '/';
  if (route === '/') return 'index.html';
  return route.endsWith('/') ? `${route.slice(1)}index.html` : route.slice(1);
}

let sitemap;
try { sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); }
catch { console.log('[subscribe] no sitemap.xml; nothing to do.'); process.exit(0); }

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let added = 0, already = 0, missing = 0, noAnchor = 0;
const notes = [];

for (const loc of locs) {
  const rel = diskPathFor(loc);
  const file = rel && path.join(ROOT, rel);
  if (!file || !fs.existsSync(file)) { missing++; continue; }

  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(MARKER)) { already++; continue; }

  const anchor = '<footer class="footer">';
  const at = html.indexOf(anchor);
  if (at === -1) { noAnchor++; continue; }

  if (!CHECK) {
    fs.writeFileSync(file, html.slice(0, at) + BLOCK.trimStart() + html.slice(at));
  }
  notes.push(`  ${rel}`);
  added++;
}

for (const n of notes.slice(0, 10)) console.log(n);
if (notes.length > 10) console.log(`  ...and ${notes.length - 10} more.`);

const tail = `${missing ? ` ${missing} not on disk.` : ''}${noAnchor ? ` ${noAnchor} with no footer to anchor to.` : ''}`;
if (added === 0) {
  console.log(`[subscribe] ${already} page(s), every one already offers a way to subscribe.${tail}`);
} else if (CHECK) {
  console.log(`[subscribe] ${added} page(s) offer no way to subscribe.${tail}`);
  process.exit(1);
} else {
  console.log(`[subscribe] ${added} page(s) given a subscribe block, ${already} already had one.${tail}`);
}
