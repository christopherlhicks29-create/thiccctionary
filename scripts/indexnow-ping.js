#!/usr/bin/env node
/**
 * Wave 190b: IndexNow integration.
 *
 * Pings api.indexnow.org with newly published URLs so Bing (+ Yandex,
 * + Seznam, + Naver) re-crawl them instantly instead of waiting for
 * their next natural crawl pass. Google does not consume IndexNow.
 *
 * The key file lives at site root as <KEY>.txt and contains only the
 * key. IndexNow validates by fetching that URL before accepting submitted
 * URLs.
 *
 * Usage:
 *   node scripts/indexnow-ping.js                       # ping today's entry + its /is/ page
 *   node scripts/indexnow-ping.js https://a https://b   # ping arbitrary URLs
 *
 * Designed to be called from daily.yml after the entry commit lands.
 * Failures are non-fatal, IndexNow is a hint, not a contract.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const HOST = new URL(SITE).host;
const KEY = '686f8bfeb5702c965f58a16126f667e9';
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const API = 'https://api.indexnow.org/indexnow';

function slugify(word) {
  let primary = String(word).split(',')[0].trim().toLowerCase();
  primary = primary.replace(/^thiccc\s+/, '');
  return primary.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function todaysUrls() {
  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  if (!entries.length) return [];
  // Entries are sorted desc by date, top one is today's
  const today = entries[0];
  const slug = slugify(today.word);
  return [
    `${SITE}/`,
    `${SITE}/entries/${today.date}.html`,
    `${SITE}/is/${slug}-thiccc/`,
    `${SITE}/is-it-thiccc/`,
    `${SITE}/archive.html`,
    `${SITE}/a-z.html`,
    `${SITE}/sitemap.xml`,
  ];
}

async function ping(urls) {
  if (!urls.length) {
    console.log('No URLs to submit.');
    return;
  }
  const body = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  };
  console.log(`IndexNow, submitting ${urls.length} URLs:`);
  urls.forEach(u => console.log(`  ${u}`));
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`IndexNow response: ${res.status} ${res.statusText} ${text || '(no body)'}`);
    // 200 = ok, 202 = accepted, 422 = key issue, 429 = rate limit, 403 = key not at expected location
    if (res.status >= 400) {
      console.warn('IndexNow rejected the submission. Non-fatal.');
      process.exitCode = 0;
    }
  } catch (e) {
    console.warn('IndexNow ping failed:', e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const urls = args.length ? args : await todaysUrls();
  await ping(urls);
}

main().catch(e => { console.error(e); process.exit(0); });
