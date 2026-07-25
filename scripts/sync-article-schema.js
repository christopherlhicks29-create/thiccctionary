#!/usr/bin/env node
/**
 * sync-article-schema.js - Wave 318
 *
 * Five generators write articles. Three of them emit Article/NewsArticle
 * JSON-LD and two -- generate-mailbag.js and generate-from-the-boat.js -- do
 * not, so 13 published articles sit in the sitemap with no structured data
 * while the article next to them has it. Search engines read the difference;
 * nobody reading the site can see it, which is why it went unnoticed.
 *
 * The obvious fix is to paste the schema block into the two generators. That
 * is how there came to be three copies of it, and it guarantees a sixth
 * generator ships without one. So this reconciles instead, and a generator
 * added later is covered on the day it ships rather than on the day someone
 * notices.
 *
 * Nothing is authored. A page already declares its headline, its description,
 * its canonical URL and its share image in its own head, and dated articles
 * carry the publication date in the filename. The schema block is those facts
 * rearranged -- which is exactly why it should not have been typed a third
 * time.
 *
 * Insert-only: a page that already carries any JSON-LD is left alone, so the
 * three generators that do their own thing keep doing it.
 *
 * Usage: node scripts/sync-article-schema.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'articles');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const CHECK = process.argv.includes('--check');

const grab = (html, re) => {
  const m = html.match(re);
  return m ? m[1].trim() : null;
};

// The bylines are staff names in "Firstname Whitmore" form and every article
// description opens with one. Read it rather than mapping slug prefixes to
// names, which would be a fourth place the masthead is written down.
function authorFrom(desc) {
  const m = (desc || '').match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}),?\s+(?:answers|writes|replies|reports|files|on\b|,)/);
  return m ? m[1] : null;
}

let added = 0, already = 0, skipped = 0;
const notes = [];

for (const name of fs.readdirSync(DIR).sort()) {
  if (!name.endsWith('.html') || name === 'index.html') continue;
  const file = path.join(DIR, name);
  const html = fs.readFileSync(file, 'utf8');

  if (/type="application\/ld\+json"/i.test(html)) { already++; continue; }
  if (!/<\/head>/i.test(html)) { skipped++; continue; }

  const headline = grab(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i)
    || grab(html, /<title>([^<]*)<\/title>/i);
  const description = grab(html, /<meta\s+name="description"\s+content="([^"]*)"/i)
    || grab(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i);
  const url = grab(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i)
    || `${SITE}/articles/${name}`;
  const image = grab(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
  const date = (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || null;

  if (!headline) { skipped++; continue; }

  // NewsArticle for the dated desks, Article for the evergreen essays. That is
  // the same split the three generators that already emit schema settled on.
  const node = {
    '@context': 'https://schema.org',
    '@type': date ? 'NewsArticle' : 'Article',
    headline,
    mainEntityOfPage: url,
  };
  if (description) node.description = description;
  if (date) node.datePublished = date;
  if (image) node.image = image;
  const author = authorFrom(description);
  if (author) node.author = { '@type': 'Person', name: author };
  node.publisher = { '@type': 'Organization', name: 'The Thiccctionary' };

  const block = `<script type="application/ld+json">${JSON.stringify(node)}</script>\n`;

  if (!CHECK) fs.writeFileSync(file, html.replace(/<\/head>/i, `${block}</head>`));
  notes.push(`  ${name}: ${node['@type']}${author ? ` by ${author}` : ' (no byline found)'}`);
  added++;
}

for (const n of notes.slice(0, 15)) console.log(n);
if (notes.length > 15) console.log(`  ...and ${notes.length - 15} more.`);

const tail = skipped ? ` ${skipped} skipped.` : '';
if (added === 0) {
  console.log(`[schema] ${already} article(s), all already carry structured data.${tail}`);
} else if (CHECK) {
  console.log(`[schema] ${added} article(s) carry no structured data.${tail}`);
  process.exit(1);
} else {
  console.log(`[schema] ${added} article(s) given structured data, ${already} already had it.${tail}`);
}
