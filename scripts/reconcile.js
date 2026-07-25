#!/usr/bin/env node
/**
 * reconcile.js - Wave 320
 *
 * Seventeen reconcilers have to run, in order, after anything writes content.
 * Until now that order was written out as seventeen YAML steps in daily.yml,
 * and again in from-the-boat.yml, and again in mailbag.yml, and again in
 * thiccc-beat.yml -- and *not* in regenerate-images.yml, which had two of the
 * seventeen.
 *
 * That omission shipped a broken page. PR #208 renamed two photographs
 * (images/2026-05-24-crankshaft-marine-diesel.jpg became ...-z3j9.jpg), updated
 * entries.json and the entry pages, and never rebuilt the category hubs -- so
 * /category/industrial-machinery/ went live pointing two <img> tags at files
 * that no longer existed. Nothing was wrong with build-category-pages.js. It
 * simply was not in that workflow's copy of the list.
 *
 * This is the list, once. A workflow runs `node scripts/reconcile.js`. A
 * reconciler added later is picked up by every workflow on the day it ships
 * instead of the day someone notices a hub is broken.
 *
 * Every step is idempotent, so the whole chain is: running it twice over a
 * clean tree changes nothing. Order matters and is load-bearing --
 * sync-og-dimensions.js measures the image sync-social-cards.js just declared,
 * so it runs after it; sync-webp.js derives from whatever JPEG survived all of
 * the above, so it runs last.
 *
 * A failing step does not stop the chain. That matches the continue-on-error
 * the YAML steps carried: one reconciler falling over should not cost the run
 * the other sixteen. Failures are collected and reported at the end.
 *
 * Usage: node scripts/reconcile.js [--strict] [--only <substr>] [--list]
 *   --strict  exit 1 if any step failed (default exits 0, as the YAML did)
 *   --only    run just the steps whose id contains <substr>
 *   --list    print the chain and exit
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The chain. Order is the contract; ids are stable so --only can name one.
//
// Two orderings here were learned the hard way and are worth stating:
//   plate-numbers before entry-pages -- the number is derived from the entry's
//     chronological position and stored in the caption. Build the pages first
//     and they render last run's text.
//   og-cards before entry-pages -- generate-daily.js points og:image at the
//     photograph because the card does not exist yet. Rebuilding the pages
//     after the card is composed is what picks it up.
const STEPS = [
  ['plate-numbers',  'node', ['scripts/sync-plate-numbers.js'],      'Plate numbers derived from chronological position'],
  ['og-cards',       'python3', ['scripts/build-entry-og-images.py'], 'Entry share cards (needs pillow)'],
  ['entry-pages',    'node', ['scripts/build-entry-pages.js'],        'Entry pages, incl. picking up new cards'],
  ['homepage',       'node', ['scripts/prerender-homepage.js'],       'Homepage prerender'],
  ['az',             'node', ['scripts/prerender-az.js'],             'A-Z index prerender'],
  ['is-pages',       'node', ['scripts/build-is-pages.js'],           '"Is X thiccc?" SEO pages'],
  ['article-listings', 'node', ['scripts/regenerate-article-listings.js'], 'Article index listings'],
  ['article-heads',  'node', ['scripts/normalize-article-heads.js'],  'Article <head> normalisation'],
  ['category-pages', 'node', ['scripts/build-category-pages.js'],     'Category hubs'],
  ['sitemap',        'node', ['scripts/sync-sitemap.js'],             'sitemap.xml'],
  ['headings',       'node', ['scripts/fix-heading-hierarchy.js'],    'Heading hierarchy'],
  ['footer',         'node', ['scripts/sync-footer-links.js'],        'Footer links'],
  ['article-og',     'node', ['scripts/sync-article-og.js'],          'Articles point at their own OG cards'],
  ['article-schema', 'node', ['scripts/sync-article-schema.js'],      'JSON-LD on every article'],
  ['subscribe',      'node', ['scripts/sync-subscribe.js'],           'Subscribe block on every sitemap page'],
  ['social-cards',   'node', ['scripts/sync-social-cards.js'],        'Complete share cards'],
  ['og-dimensions',  'node', ['scripts/sync-og-dimensions.js'],       'og:image dimensions, measured'],
  ['webp',           'node', ['scripts/sync-webp.js'],                'WebP derivatives'],
];

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const onlyAt = argv.indexOf('--only');
const ONLY = onlyAt !== -1 ? argv[onlyAt + 1] : null;

if (argv.includes('--list')) {
  for (const [id, , , desc] of STEPS) console.log(`  ${id.padEnd(16)} ${desc}`);
  process.exit(0);
}

const chain = ONLY ? STEPS.filter(([id]) => id.includes(ONLY)) : STEPS;
if (!chain.length) {
  console.error(`[reconcile] no step matches --only "${ONLY}". Try --list.`);
  process.exit(1);
}

const failed = [];
for (const [id, cmd, args, desc] of chain) {
  console.log(`\n=== [reconcile] ${id} - ${desc}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  const code = r.status;
  if (r.error || code !== 0) {
    // Not fatal, deliberately: sixteen working reconcilers should not be lost
    // to one broken one. The summary below is what a run gets judged on.
    failed.push(`${id} (${r.error ? r.error.code || r.error.message : `exit ${code}`})`);
    console.log(`--- [reconcile] ${id} FAILED, continuing.`);
  }
}

const ok = chain.length - failed.length;
console.log(`\n[reconcile] ${ok}/${chain.length} step(s) succeeded.`);
if (failed.length) {
  for (const f of failed) console.log(`  failed: ${f}`);
  if (STRICT) process.exit(1);
}
