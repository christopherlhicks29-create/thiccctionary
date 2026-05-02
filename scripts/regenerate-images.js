/**
 * Re-runs Unsplash image search + AI vision pick for existing entries,
 * replacing their images with picks made by the tuned prompt. Also
 * rebuilds each updated entry's per-entry HTML page + the sitemap so
 * the static pages reference the new image paths.
 *
 * Triggered by .github/workflows/regenerate-images.yml (manual only).
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - UNSPLASH_ACCESS_KEY
 *   - DATES (optional)            comma-separated YYYY-MM-DD dates. Default: every entry except today.
 *   - SUBJECT_OVERRIDE (optional) hand-pick a search query for these dates instead of entry.word.
 *                                  Useful when entry.word returns wrong-subject Unsplash results.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntryPage, buildSitemap } from './build-entry-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const IMAGES_DIR = path.join(ROOT, 'images');

async function searchUnsplash(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape&content_filter=high`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  });
  if (!res.ok) throw new Error(`Unsplash search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.results.map(r => ({
    id: r.id,
    description: r.description || r.alt_description || '',
    fullUrl: r.urls.regular,
    thumbUrl: r.urls.small,
    photographer: r.user.name,
    photographerUrl: r.user.links.html,
    unsplashUrl: r.links.html,
    downloadLocation: r.links.download_location,
  }));
}

async function pickThiccestImage(subject, candidates) {
  const subset = candidates.slice(0, 12);
  const imageMessages = subset.map(c => ({
    type: 'image_url',
    image_url: { url: c.thumbUrl, detail: 'low' },
  }));

  const sysPrompt = `You evaluate photos for "Thiccctionary," a satirical site about THICK objects. Your goal: pick the photo where the subject's overall girth and silhouette are most obvious to someone seeing it for the first time.

CRITICAL — the photo MUST show the WHOLE subject in frame:
- The full silhouette must be visible — head to tail, end to end
- A reader should be able to see the subject's overall shape at a glance
- REJECT tight crops, detail shots, side panels, single wheels, engine close-ups, or any composition where you can only see PART of the subject
- If NONE of the candidates show the full subject, pick the one with the most of it visible

Avoid:
- Photos that include people, bodies, body parts, or hands
- Photos that look like marketing/product renders or illustrations
- Photos with watermarks or text overlays
- Photos where the subject is too small, obscured, or in deep shadow
- Detail shots focused on engineering parts rather than overall form

Prefer:
- Rear three-quarter angles, side profiles, or back views that show the FULL subject silhouette and emphasize girth
- Isolated subjects against clean backgrounds with good separation from clutter
- Natural light, especially golden hour
- Vintage / weathered / character-rich examples`;

  const userPrompt = `Subject: ${subject}

Below are ${subset.length} candidate photos numbered 1 through ${subset.length}. Pick the one most fitting for a satirical "thicc" entry about this subject.

Output JSON only:
{
  "pick": <integer 1-${subset.length}>,
  "reason": "one short sentence on why this photo is the thiccest"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageMessages] },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Vision pick failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const result = JSON.parse(data.choices[0].message.content);
  const idx = Math.max(1, Math.min(subset.length, result.pick)) - 1;
  console.log(`  Vision picked #${idx + 1}: ${result.reason}`);
  return subset[idx];
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
  if (!process.env.OPENAI_API_KEY || !process.env.UNSPLASH_ACCESS_KEY) {
    console.error('OPENAI_API_KEY and UNSPLASH_ACCESS_KEY are required.');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  const datesInput = (process.env.DATES || 'all-except-today').trim();
  let toProcess;
  if (datesInput === 'all-except-today' || datesInput === '') {
    toProcess = entries.filter(e => e.date !== today);
    console.log(`Processing all entries except today (${today}). ${toProcess.length} entries.`);
  } else {
    const dates = datesInput.split(',').map(s => s.trim()).filter(Boolean);
    toProcess = entries.filter(e => dates.includes(e.date));
    console.log(`Processing ${toProcess.length} entries (dates: ${dates.join(', ')}).`);
  }

  if (toProcess.length === 0) {
    console.log('Nothing to process.');
    return;
  }

  const override = (process.env.SUBJECT_OVERRIDE || '').trim();
  if (override) {
    console.log(`SUBJECT_OVERRIDE active: using "${override}" as search query for all selected dates.`);
  }

  let succeeded = 0;
  let failed = 0;

  for (const entry of toProcess) {
    console.log(`\n--- ${entry.date}: ${entry.word} ---`);
    try {
      const cleanedQuery = entry.word.replace(/\bthicc+(c+|er|est)?\b/gi, '').replace(/\s+/g, ' ').trim();
      const primaryQuery = override || entry.word;
      let candidates = await searchUnsplash(primaryQuery);
      console.log(`  Searched "${primaryQuery}" -> ${candidates.length} results.`);
      if (candidates.length === 0 && !override && cleanedQuery && cleanedQuery !== entry.word) {
        console.log(`  Retrying with cleaned query "${cleanedQuery}".`);
        candidates = await searchUnsplash(cleanedQuery);
      }
      if (candidates.length === 0) {
        console.log(`  No Unsplash results -- skipping.`);
        failed++;
        continue;
      }

      const subjectForVision = override || entry.word;
      const chosen = await pickThiccestImage(subjectForVision, candidates);
      const filename = `${entry.date}.jpg`;
      await downloadImage(chosen, filename);
      console.log(`  Saved new image: images/${filename}`);

      entry.image = `images/${filename}`;
      entry.photographer = chosen.photographer;
      entry.photographerUrl = chosen.photographerUrl;
      entry.unsplashUrl = chosen.unsplashUrl;
      succeeded++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  await fs.writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2));

  console.log('\nRebuilding entry HTML pages...');
  for (const entry of toProcess) {
    try {
      const updated = entries.find(e => e.date === entry.date);
      if (updated) {
        await buildEntryPage(updated);
        console.log(`  Rebuilt entries/${entry.date}.html`);
      }
    } catch (err) {
      console.error(`  Failed to rebuild ${entry.date}.html: ${err.message}`);
    }
  }
  await buildSitemap(entries);
  console.log('  Sitemap rebuilt.');

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed (out of ${toProcess.length}).`);
  if (failed > 0 && succeeded === 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
