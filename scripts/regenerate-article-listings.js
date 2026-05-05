/**
 * Regenerates the article listings on:
 *   1. Homepage's "From the Editorial Desk" section (top 5 most recent)
 *   2. Articles index page (all articles, in chronological order)
 *
 * Single source of truth: data/articles.json
 *
 * Run after adding/removing/editing an entry in data/articles.json:
 *   node scripts/regenerate-article-listings.js
 *
 * Both index.html and articles/index.html contain HTML-comment sentinels
 * that mark where the auto-generated content begins and ends. Don't remove
 * the sentinels or the script will refuse to run.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ARTICLES_PATH = path.join(ROOT, 'data', 'articles.json');
const HOMEPAGE_PATH = path.join(ROOT, 'index.html');
const LISTING_PATH = path.join(ROOT, 'articles', 'index.html');

const HOMEPAGE_LIMIT = 5;

function humanDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function homepageCard(a) {
  return `      <a href="articles/${a.slug}.html" style="display: block; padding: 1rem; border: 1px solid rgba(0,0,0,0.1); border-radius: 4px; text-decoration: none; color: inherit; transition: background 0.15s;">
        <p style="margin: 0; font-weight: 600;">${a.title}</p>
        <p style="margin: 0.4rem 0 0; opacity: 0.75; font-size: 0.95rem;">${a.description}</p>
      </a>`;
}

function listingCard(a) {
  return `    <article style="border-bottom: 1px solid rgba(0,0,0,0.1); padding: 1.5rem 0;">
      <p style="opacity: 0.6; font-size: 0.9rem;">${humanDate(a.date)}</p>
      <h3 style="margin: 0.5rem 0;"><a href="${a.slug}.html">${a.title}</a></h3>
      <p>${a.description}</p>
    </article>`;
}

function replaceBetweenSentinels(content, startMarker, endMarker, replacement, filePath) {
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1) {
    throw new Error(`Start sentinel not found in ${filePath}: ${startMarker}`);
  }
  if (endIdx === -1) {
    throw new Error(`End sentinel not found in ${filePath}: ${endMarker}`);
  }
  if (endIdx < startIdx) {
    throw new Error(`End sentinel appears before start sentinel in ${filePath}`);
  }
  return (
    content.slice(0, startIdx + startMarker.length) +
    '\n' + replacement + '\n      ' +
    content.slice(endIdx)
  );
}

async function main() {
  const articles = JSON.parse(await fs.readFile(ARTICLES_PATH, 'utf8'));
  // Sort by date descending (newest first)
  articles.sort((a, b) => b.date.localeCompare(a.date));

  // 1. Homepage: top N most recent
  const topN = articles.slice(0, HOMEPAGE_LIMIT);
  const homepageHtml = topN.map(homepageCard).join('\n');
  let homepage = await fs.readFile(HOMEPAGE_PATH, 'utf8');
  homepage = replaceBetweenSentinels(
    homepage,
    '<!-- ARTICLES:HOMEPAGE:START -->',
    '<!-- ARTICLES:HOMEPAGE:END -->',
    homepageHtml,
    HOMEPAGE_PATH
  );
  await fs.writeFile(HOMEPAGE_PATH, homepage);
  console.log(`Updated ${path.relative(ROOT, HOMEPAGE_PATH)} with ${topN.length} articles.`);

  // 2. Articles listing: all articles
  const listingHtml = articles.map(listingCard).join('\n\n');
  let listing = await fs.readFile(LISTING_PATH, 'utf8');
  listing = replaceBetweenSentinels(
    listing,
    '<!-- ARTICLES:LISTING:START -->',
    '<!-- ARTICLES:LISTING:END -->',
    listingHtml,
    LISTING_PATH
  );
  await fs.writeFile(LISTING_PATH, listing);
  console.log(`Updated ${path.relative(ROOT, LISTING_PATH)} with all ${articles.length} articles.`);
}

main().catch(err => { console.error(err); process.exit(1); });
