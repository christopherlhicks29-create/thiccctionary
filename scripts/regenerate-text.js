/**
 * Re-runs the satirical entry-text generation for existing entries WITHOUT
 * touching their image. Useful when entry text is weak but the image is fine,
 * or when the entry-gen prompt has been improved and you want to backfill.
 *
 * Triggered by .github/workflows/regenerate-text.yml (manual only).
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - DATES                       comma-separated YYYY-MM-DD dates. REQUIRED.
 *   - WORD_OVERRIDE (optional)    replace headword for the selected date with
 *                                 this string. Single-date use only.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntryPage, buildSitemap } from './build-entry-pages.js';
import { buildRssFeed } from './build-rss.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');

async function generateEntry(subject, photo) {
  const sysPrompt = `You write entries for "Thiccctionary" — a satirical daily dictionary of THICK INANIMATE OBJECTS. Tone: scholarly dictionary register × dry comedy × internet vernacular. Keep it tasteful — the joke is applying body-positive thirst language to objects, never to people. NEVER reference humans, anatomy, or body parts in your output. Light HTML (<em>) allowed inside strings. Output strict JSON only.

VOICE TARGETS — match these patterns:

DEFINITIONS — should sound like Merriam-Webster wrote them after one drink. Use dictionary register (esp., colloq., slang.) but slip in voicy flourishes. Examples:
- "A widebody aircraft whose aft fuselage exhibits significantly more curvature than its fore fuselage; esp. one parked tail-toward the camera at golden hour."
- "An industrial vehicle of contemplative rotundity, characterized by a single, slowly-rotating, drum-shaped midsection."
- "The platonic ideal of thicccness: all body, no apologies."

ETYMOLOGIES — lead with REAL, VERIFIABLE etymology, then close with a comedic kicker that lands. The etymology MUST be REAL. Do NOT invent fictional Old English / Old French / Proto-Germanic / Sanskrit forms. Do NOT make up word origins. Fall back to: (a) etymology of a related/component word you DO know, (b) the named inventor or company, (c) a dated first-attestation in print. Fabricated etymologies destroy the joke.

EXAMPLES — must include "thiccc" (three c's). One crisp sentence (optionally + a short tag). Use brand/model/proper-noun specificity.

AVOID:
- Fabricated word origins
- Generic glosses that just translate the parts
- Etymologies without a comedic kicker
- Flat constructions ("Replaced my X with this thiccc Y")
- Marketing language`;

  const userPrompt = `Today's subject: "${subject}"

The photo we chose: ${photo.description ? `"${photo.description}"` : '(no caption available)'}, by ${photo.photographer} on Unsplash.

Write the dictionary entry. Reference the actual photo loosely but don't get specific about details you can't verify.

Schema:
{
  "word": "${subject}",
  "pronunciation": "/sim-pul re-SPEL-ing/",
  "partOfSpeech": "n.",
  "definitions": ["definition 1", "optional definition 2"],
  "example": "ONE sentence using BOTH the headword AND the literal word \\"thiccc\\" (three c's).",
  "etymology": "Real etymology FIRST, THEN a comedic kicker.",
  "caption": "Plate N. — A short caption for the image, dictionary-illustration style.",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.75,
    }),
  });
  if (!res.ok) throw new Error(`Entry gen failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is required.');
    process.exit(1);
  }
  const datesInput = (process.env.DATES || '').trim();
  if (!datesInput) {
    console.error('DATES is required (comma-separated YYYY-MM-DD).');
    process.exit(1);
  }
  const wordOverride = (process.env.WORD_OVERRIDE || '').trim();

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  const dates = datesInput.split(',').map(s => s.trim()).filter(Boolean);
  const toProcess = entries.filter(e => dates.includes(e.date));

  if (toProcess.length === 0) {
    console.error(`No entries match dates: ${dates.join(', ')}`);
    process.exit(1);
  }
  if (wordOverride && toProcess.length > 1) {
    console.error(`WORD_OVERRIDE only makes sense with a single date. Got ${toProcess.length}.`);
    process.exit(1);
  }

  console.log(`Processing ${toProcess.length} entries (dates: ${dates.join(', ')}).`);
  if (wordOverride) console.log(`WORD_OVERRIDE active: replacing headword with "${wordOverride}".`);

  let succeeded = 0, failed = 0;
  for (const entry of toProcess) {
    const subject = wordOverride || entry.word;
    console.log(`\n--- ${entry.date}: ${entry.word}${wordOverride ? ` -> ${wordOverride}` : ''} ---`);
    try {
      const photo = { description: entry.caption || '', photographer: entry.photographer || 'unknown' };
      const fresh = await generateEntry(subject, photo);
      entry.word = fresh.word;
      entry.pronunciation = fresh.pronunciation;
      entry.partOfSpeech = fresh.partOfSpeech;
      entry.definitions = fresh.definitions;
      entry.example = fresh.example;
      entry.etymology = fresh.etymology;
      entry.caption = fresh.caption;
      entry.tags = fresh.tags;
      console.log(`  New headword: ${fresh.word}`);
      console.log(`  New example:  ${fresh.example}`);
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
  await buildRssFeed(entries);
  console.log('  RSS feed rebuilt.');

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed (out of ${toProcess.length}).`);
  if (failed > 0 && succeeded === 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
