/**
 * inject-entry.js  -  publish a HANDCRAFTED daily entry without OpenAI.
 *
 * The normal daily pipeline (generate-daily.js) writes the entry copy with
 * OpenAI. When the OpenAI quota is exhausted (429 insufficient_quota) the daily
 * cron bails and the homepage goes stale. This script is the manual fallback:
 * a human (or the PO) writes the copy into data/.inject-entry.json, pushes it,
 * and the inject-entry workflow fetches a real Unsplash photo (key lives in
 * Actions), assembles the entry, and inserts it into the catalog.
 *
 * Env: UNSPLASH_ACCESS_KEY (required).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const IMAGES_DIR = path.join(ROOT, 'images');
const SENTINEL_PATH = path.join(ROOT, 'data', '.inject-entry.json');

const CANON_TAGS = new Set(['girth','produce','industrial','construction','vehicle','maritime','architecture','instrument','culinary','natural-specimens','landscape','domestic','tools']);
const CAT_TAG = {
  'Vehicles & Transport':'vehicle','Architecture & Infrastructure':'architecture',
  'Industrial Machinery':'industrial','Produce & Botanical':'produce',
  'Foods of Substance':'culinary','Domestic Goods':'domestic',
  'Musical Instruments':'instrument','Natural Specimens':'natural-specimens'
};
const VALID_CATEGORIES = new Set([
  'Vehicles & Transport','Architecture & Infrastructure','Industrial Machinery',
  'Produce & Botanical','Foods of Substance','Domestic Goods','Engineering Marvels','Musical Instruments'
]);

function stripEm(s) {
  return String(s == null ? '' : s).replace(new RegExp("\\s*[\\u2014\\u2013]\\s*","g"), ', ').replace(/, ,/g, ',');
}

async function searchUnsplash(query) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '30');
  url.searchParams.set('orientation', 'squarish');
  url.searchParams.set('content_filter', 'high');
  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' },
  });
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error(`No Unsplash results for query: ${query}`);
  return data.results.map(r => ({
    id: r.id,
    description: r.description || r.alt_description || '',
    fullUrl: r.urls.regular,
    photographer: r.user.name,
    photographerUrl: r.user.links.html,
    unsplashUrl: r.links.html,
    downloadLocation: r.links.download_location,
  }));
}

async function downloadImage(photo, filename) {
  const res = await fetch(photo.fullUrl);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, filename), buf);
  await fetch(photo.downloadLocation, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  }).catch(() => {});
}

async function main() {
  let sentinel;
  try {
    sentinel = JSON.parse(await fs.readFile(SENTINEL_PATH, 'utf8'));
  } catch (e) {
    console.error('No readable data/.inject-entry.json sentinel. Nothing to inject.');
    process.exit(0);
  }

  const today = sentinel.date || new Date().toISOString().slice(0, 10);
  if (!sentinel.word) throw new Error('sentinel missing required field: word');
  if (!Array.isArray(sentinel.definitions) || sentinel.definitions.length === 0) throw new Error('sentinel missing definitions[]');
  const query = sentinel.unsplashQuery || sentinel.word.split(',')[0];

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  if (entries.some(e => e.date === today)) {
    console.log(`Entry for ${today} already exists. Refusing to duplicate. Exiting.`);
    await fs.rm(SENTINEL_PATH, { force: true });
    return;
  }

  console.log(`Injecting handcrafted entry "${sentinel.word}" for ${today} (query: "${query}")`);
  const candidates = await searchUnsplash(query);
  const chosen = candidates[0];
  console.log(`Chosen photo by ${chosen.photographer}: ${chosen.unsplashUrl}`);

  const slug = sentinel.word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const filename = `${today}-${slug}.jpg`;
  await downloadImage(chosen, filename);
  console.log(`Saved image: images/${filename}`);

  const category = VALID_CATEGORIES.has(sentinel.category) ? sentinel.category : 'Uncategorized';
  let tags = [...new Set((sentinel.tags || []).map(x => String(x).toLowerCase().trim()).filter(x => CANON_TAGS.has(x)))];
  const base = CAT_TAG[category];
  if (base && !tags.includes(base)) tags.unshift(base);
  if (tags.length === 0) tags = ['girth'];
  tags = tags.slice(0, 4);

  const entry = {
    date: today,
    word: sentinel.word,
    pronunciation: sentinel.pronunciation || `/${sentinel.word.toLowerCase().replace(/[^a-z\s]/g,'').replace(/\s+/g,' ').trim()}/`,
    partOfSpeech: sentinel.partOfSpeech || 'n.',
    definitions: sentinel.definitions.map(stripEm),
    example: stripEm(sentinel.example || ''),
    etymology: stripEm(sentinel.etymology || ''),
    image: `images/${filename}`,
    caption: stripEm(sentinel.caption || ''),
    tags,
    category,
    bookReady: null,
    humorScore: typeof sentinel.humorScore === 'number' ? sentinel.humorScore : null,
    photoScore: null,
    photographer: chosen.photographer,
    photographerUrl: chosen.photographerUrl,
    unsplashUrl: chosen.unsplashUrl,
  };
  if (sentinel.socialCaptions && typeof sentinel.socialCaptions === 'object') {
    entry.socialCaptions = sentinel.socialCaptions;
  }

  let insertAt = entries.findIndex(e => e.date < entry.date);
  if (insertAt === -1) insertAt = entries.length;
  entries.splice(insertAt, 0, entry);
  await fs.writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2));
  console.log(`Inserted at index ${insertAt}. entries.json now has ${entries.length} entries.`);

  await fs.rm(SENTINEL_PATH, { force: true });
  console.log('Removed sentinel. Done. Page prerender happens in the workflow.');
}

main().catch(err => {
  console.error('inject-entry failed:', err.message);
  process.exit(1);
});
