#!/usr/bin/env node
/**
 * sync-article-og.js - Wave 314
 *
 * build-article-og-images.py renders one card per article into articles/og/,
 * named after the article's slug. Fifty of them exist. Four articles were never
 * repointed at theirs and still declare og:image as a raw entry photograph or
 * the site default -- so the four articles with the most deliberate share cards
 * on the site are the four sharing something else. One of them named a photo
 * file that a later regeneration replaced, so it was pointing at nothing.
 *
 * The card that belongs to an article is not a fact worth typing: it is the
 * slug. This derives it, and corrects any page that disagrees.
 *
 * Idempotent. Run before sync-og-dimensions.js, which then measures whatever
 * this leaves behind.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'articles');
const SITE = process.env.SITE_BASE_URL || 'https://thiccctionary.com';

let fixed = 0, already = 0, noCard = 0;

for (const name of fs.readdirSync(DIR)) {
  if (!name.endsWith('.html') || name === 'index.html') continue;
  const slug = name.replace(/\.html$/, '');
  if (!fs.existsSync(path.join(DIR, 'og', `${slug}.png`))) { noCard++; continue; }

  const file = path.join(DIR, name);
  const html = fs.readFileSync(file, 'utf8');
  const want = `${SITE}/articles/og/${slug}.png`;

  let next = html
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/, `$1${want}$2`)
    .replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*(")/, `$1${want}$2`);

  if (next === html) { already++; continue; }
  fs.writeFileSync(file, next);
  fixed++;
}

console.log(fixed === 0
  ? `[article-og] ${already} article(s), all already pointing at their own card.${noCard ? ` ${noCard} have no card.` : ''}`
  : `[article-og] ${fixed} article(s) repointed, ${already} already correct.${noCard ? ` ${noCard} have no card.` : ''}`);
