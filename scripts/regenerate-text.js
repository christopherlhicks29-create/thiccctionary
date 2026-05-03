/**
 * Re-runs the satirical entry-text generation for existing entries WITHOUT
 * touching their image. Useful when the entry's text (definition, etymology,
 * example) is weak but the image is fine — or when the entry-gen prompt has
 * been improved and you want to backfill older entries.
 *
 * Triggered by .github/workflows/regenerate-text.yml (manual only).
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - DATES                       comma-separated YYYY-MM-DD dates. REQUIRED.
 *   - WORD_OVERRIDE (optional)    replace the headword for the selected date(s)
 *                                 with this string. Only meaningful when DATES
 *                                 contains a single date. Use when the original
 *                                 headword was weak ("Bulky Refrigerator") and
 *                                 you want a stronger one ("Frigidaire, Side-by-Side").
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntryPage, buildSitemap } from './build-entry-pages.js';
import { buildRssFeed } from './build-rss.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');

// ---------- Generate entry text (mirrors generate-daily.js generateEntry) ----------
async function generateEntry(subject, photo) {
  const sysPrompt = `You write entries for "Thiccctionary" — a satirical daily dictionary of THICK INANIMATE OBJECTS. Tone: scholarly dictionary register × dry comedy × internet vernacular. Keep it tasteful — the joke is applying body-positive thirst language to objects, never to people. NEVER reference humans, anatomy, or body parts in your output. Light HTML (<em>) allowed inside strings. Output strict JSON only.

VOICE TARGETS — match these patterns:

DEFINITIONS — should sound like Merriam-Webster wrote them after one drink. Use dictionary register (esp., colloq., slang.) but slip in voicy flourishes. The second definition (when present) should be sharper/colloquial. Examples that worked:
- "A widebody aircraft whose aft fuselage exhibits significantly more curvature than its fore fuselage; esp. one parked tail-toward the camera at golden hour."
- "An industrial vehicle of contemplative rotundity, characterized by a single, slowly-rotating, drum-shaped midsection."
- "The platonic ideal of thicccness: all body, no apologies."
- "Any specimen exceeding 400g and exhibiting what botanists term 'a generous undercarriage'."

ETYMOLOGIES — lead with REAL, VERIFIABLE etymology (Latin/Greek/Middle English/Old French/Spanish/Nahuatl/named industrialists/dated coinages), then close with a comedic kicker that lands. This is where the personality lives.

CRITICAL — the etymology MUST be REAL. Do NOT invent fictional Old English / Old French / Proto-Germanic / Sanskrit forms. Do NOT make up word origins. If you cannot recall the real etymology of the word with confidence, fall back to: (a) etymology of a related/component word you DO know, (b) the named inventor or company, (c) a dated first-attestation in print. Fabricated etymologies destroy the joke — the entire conceit of Thiccctionary is fake-academic register applied to real linguistic facts. A made-up "Old English 'cynce'" is brand-damaging, not funny.

Examples that worked:
- "From Spanish aguacate, from Nahuatl āhuacatl, originally meaning 'testicle' — which, frankly, tracks."
- "From thiccc (internet vernacular, c. 2015, 'voluptuous; full-bodied,' with an extra c for emphasis) + Boeing Company (Seattle-based aircraft manufacturer, est. 1916). First attested on Thiccctionary.com, May 2026."
- "From Henry Ford (industrialist) + the model code for the heaviest-duty pickup in the lineup. The numerical suffix correlates positively with girth."

AVOID:
- Fabricated word origins ("from Old English 'cynce'" — there is no such word)
- Generic glosses that just translate the parts ("from Latin X meaning Y, combined with Z meaning W")
- Etymologies without a comedic kicker — the kicker is mandatory.

EXAMPLES — must include "thiccc" (three c's). Should be ONE crisp sentence or a sentence + a sharp tag. Use brand/model/proper-noun specificity, not generic placeholders. Strong examples that worked:
- "That 747 is straight-up a thiccc Boeing. The empennage on her? Architectural."
- "Florida grew an avocado so thiccc it required two hands and a pre-meal stretch. Toast was just the canvas."
- "He pulled up in a thiccc F-450 and the parking lot reorganized around him. The dually rear axle takes up two spaces by birthright."

AVOID:
- Flat constructions ("Replaced my X with this thiccc Y")
- Real-estate / interior-design copy ("effortlessly enhancing the aesthetic of any living space", "elevating any room")
- Generic compliments ("such a statement piece", "absolute showstopper")
- Marketing language. The example is a witness account, not a product description.`;

  const userPrompt = `Today's subject: "${subject}"

The photo we chose: ${photo.description ? `"${photo.description}"` : '(no caption available)'}, by ${photo.photographer} on Unsplash.

Write the dictionary entry. Reference the actual photo loosely (e.g. "esp. when photographed at golden hour" or "the subject's posterior, viewed astern, defies casual description") but don't get specific about details you can't verify.

Schema:
{
  "word": "${subject}",
  "pronunciation": "/sim-pul re-SPEL-ing/",
  "partOfSpeech": "n.",
  "definitions": ["definition 1 (1-2 sentences, dictionary register, voicy)", "optional definition 2 (sharper / colloquial — labeled with <em>colloq.</em> or <em>slang.</em>)"],
  "example": "ONE sentence (optionally + a short tag) using BOTH the headword AND the literal word \"thiccc\" (always three c's). Use brand/model/proper-noun specificity. Avoid 'Replaced my X with this thiccc Y' — pick a scene.",
  "etymology": "Real etymology FIRST (Latin/Greek/Middle English/Spanish/Nahuatl/etc., dated coinages, named industrialists) THEN a comedic kicker. The kicker is what makes the entry sing.",
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
    console.error('DATES is required (comma-separated YYYY-MM-DD list).');
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

  let succeeded = 0;
  let failed = 0;

  for (const entry of toProcess) {
    const subject = wordOverride || entry.word;
    console.log(`\n--- ${entry.date}: ${entry.word}${wordOverride ? ` -> ${wordOverride}` : ''} ---`);
    try {
      // Reconstruct a minimal photo descriptor from existing entry metadata.
      // The image stays put; we just give the LLM the same context it had originally.
      const photo = {
        description: entry.caption || '',
        photographer: entry.photographer || 'unknown',
      };

      const fresh = await generateEntry(subject, photo);

      // Mutate in place — preserve image, photographer, date.
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
  if (failed > 0 && succeeded === 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
