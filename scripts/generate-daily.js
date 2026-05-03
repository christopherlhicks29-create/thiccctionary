/**
 * Thiccctionary daily entry generator.
 *
 * Pipeline:
 *   1. AI picks today's subject (a "thicc" object/vehicle/fruit/etc.)
 *   2. Unsplash API returns up to 30 candidate photos for that subject
 *   3. AI vision model picks the photo that looks the thiccest
 *   4. Download the chosen image, save to /images/YYYY-MM-DD.jpg
 *   5. AI writes a satirical dictionary entry referencing that specific photo
 *   6. Append entry to data/entries.json with photographer attribution
 *
 * The cron workflow then opens a Pull Request — you review on your phone
 * (GitHub mobile renders the image preview), tap merge, and a second
 * workflow posts to Buffer + Cloudflare Pages auto-deploys.
 *
 * Required env vars:
 *   - OPENAI_API_KEY              text + vision
 *   - UNSPLASH_ACCESS_KEY         photo search (free tier: 50 req/hour)
 *
 * Optional env vars:
 *   - SUBJECT_OVERRIDE            force a specific subject (e.g. "vintage Cadillac")
 */

import fs from 'node:fs/promises';
import { buildRssFeed } from './build-rss.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntryPage, buildSitemap } from './build-entry-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const IMAGES_DIR = path.join(ROOT, 'images');

// ---------- 1. Pick today's subject ----------
async function pickSubject(usedWords) {
  const sysPrompt = `You suggest subjects for "Thiccctionary" — a satirical daily dictionary of THICK INANIMATE OBJECTS (never people, never bodies, never animals). Categories: aircraft, vehicles, ships, trains, fruit, vegetables, furniture, buildings, appliances, tools, machinery, musical instruments, packaged goods. The subject must be something that would plausibly be photographed on Unsplash and look genuinely chunky/curvy/voluminous in good photos.

HEADWORD STYLE — this is the most important part. The headword should feel like a real dictionary entry, with VOICE and SPECIFICITY. Three patterns work; rotate through them:

1. COMMA-QUALIFIER ("Avocado, Domestic" / "Refrigerator, Side-by-Side" / "Cadillac, c. 1959") — dictionary-cataloguing register. Strong default.
2. ALLITERATIVE-DESCRIPTOR ("Concrete Cathedral" / "Bulbous Bouy" / "Pendulous Pumpkin") — only if the alliteration is genuinely good.
3. PROPER-NOUN-FORWARD ("Thiccc Boeing" / "Frigidaire Imperial" / "Steinway, Concert Grand") — when the brand IS the punchline.

AVOID weak generic-adjective + noun patterns. The full ban list of qualifiers that you MAY NOT use as the lead adjective: Big, Bulky, Large, Round, Heavy, Chunky, Hefty, Plump, Plush, Thick, Wide, Fat, Stout, Sturdy, Massive, Huge, Dense, Solid. If your headword starts with any of these, START OVER. They are filler — they tell the reader nothing the eye doesn't already see. Instead, push for: specific cultivar/model/era ("Heritage Tomato", "Ford F-450", "Mid-Century Armchair"); branded specificity ("Frigidaire Imperial", "Steinway, Concert Grand"); botanical or mechanical register ("Concrete Mixer", "Avocado, Domestic"); or proper-noun-forward construction where the brand IS the punchline ("Thiccc Boeing").

Output strict JSON only.`;

  const userPrompt = `Suggest today's subject. Avoid recently used: ${usedWords.join(', ') || '(none)'}.

Reference for the bar (these were strong picks):
- "Avocado, Domestic"  (comma-qualifier — botanical register)
- "Thiccc Boeing"  (proper-noun-forward — brand carries the joke)
- "Ford F-450"  (model number specificity)
- "Heritage Tomato"  (cultivar-language qualifier)
- "Mid-Century Armchair"  (period-detail qualifier)

Reference for what to AVOID (these were weak):
- "Bulky Refrigerator"  ← generic adjective. Better: "Frigidaire, Side-by-Side" or "Refrigerator, Mid-Century Apartment"
- "Big Truck"  ← no specificity. Better: model + qualifier.

Schema:
{
  "subject": "the noun phrase being defined — must follow one of the three style patterns above",
  "unsplashQuery": "a 1-3 word search query for Unsplash that will return relevant photos (e.g. 'concrete mixer' or 'heirloom tomato'). Use the literal object name, not the qualifier.",
  "category": "one of: aircraft, vehicle, fruit, vegetable, furniture, building, appliance, tool, machinery, instrument, other"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      temperature: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`Subject pick failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ---------- 2. Search Unsplash ----------
async function searchUnsplash(query) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '30');
  url.searchParams.set('orientation', 'squarish'); // best for our square layout
  url.searchParams.set('content_filter', 'high');

  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' },
  });
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No Unsplash results for query: ${query}`);
  }
  return data.results.map(r => ({
    id: r.id,
    description: r.description || r.alt_description || '',
    thumbUrl: r.urls.small,    // ~400px — used for vision evaluation (cheap)
    fullUrl: r.urls.regular,   // ~1080px — used for the actual entry
    photographer: r.user.name,
    photographerUrl: r.user.links.html,
    unsplashUrl: r.links.html,
    downloadLocation: r.links.download_location, // Unsplash requires hitting this on use
  }));
}

// ---------- 3. AI vision picker ----------
async function pickThiccestImage(subject, candidates) {
  // gpt-4o-mini supports vision and is cheap. Send up to 12 thumbnails to keep cost low.
  const subset = candidates.slice(0, 12);
  const imageMessages = subset.map((c, i) => ({
    type: 'image_url',
    image_url: { url: c.thumbUrl, detail: 'low' }, // 'low' = cheap, fine for picking
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
  console.log(`Vision picked #${idx + 1} of ${subset.length}: ${result.reason}`);
  return subset[idx];
}

// ---------- 4. Download the chosen image ----------
async function downloadImage(photo, filename) {
  const res = await fetch(photo.fullUrl);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, filename), buf);

  // Unsplash API guidelines require pinging the download_location endpoint when using a photo
  await fetch(photo.downloadLocation, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  }).catch(() => {});
}

// ---------- 5. Generate the satirical entry ----------
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
  "pronunciation": "/sim-pul re-SPEL-ing/",  // simple respelling — capitalize the stressed syllable, hyphens between syllables, lowercase otherwise. Do NOT use IPA.
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

// ---------- main ----------
async function main() {
  const raw = await fs.readFile(ENTRIES_PATH, 'utf8').catch(() => '[]');
  const entries = JSON.parse(raw);
  const today = new Date().toISOString().slice(0, 10);

  const force = process.env.FORCE_REGENERATE === 'true';
  const existingIdx = entries.findIndex(e => e.date === today);
  if (existingIdx !== -1) {
    if (force) {
      console.log(`Entry for ${today} already exists. FORCE_REGENERATE=true — removing it and regenerating.`);
      entries.splice(existingIdx, 1);
    } else {
      console.log(`Entry for ${today} already exists. Exiting. (Set FORCE_REGENERATE=true to override.)`);
      return;
    }
  }

  // Step 1: subject
  const usedWords = entries.slice(0, 30).map(e => e.word);
  let subjectInfo;
  if (process.env.SUBJECT_OVERRIDE) {
    subjectInfo = { subject: process.env.SUBJECT_OVERRIDE, unsplashQuery: process.env.SUBJECT_OVERRIDE, category: 'other' };
  } else {
    subjectInfo = await pickSubject(usedWords);
  }
  console.log(`Subject: ${subjectInfo.subject} (query: "${subjectInfo.unsplashQuery}")`);

  // Step 2: search Unsplash
  const candidates = await searchUnsplash(subjectInfo.unsplashQuery);
  console.log(`Found ${candidates.length} candidate photos.`);

  // Step 3: pick the thiccest
  const chosen = await pickThiccestImage(subjectInfo.subject, candidates);

  // Step 4: download
  const filename = `${today}.jpg`;
  await downloadImage(chosen, filename);
  console.log(`Saved image to images/${filename}`);

  // Step 5: write the entry
  const entryCopy = await generateEntry(subjectInfo.subject, chosen);

  // Step 6: assemble + save
  const entry = {
    date: today,
    word: entryCopy.word,
    pronunciation: entryCopy.pronunciation,
    partOfSpeech: entryCopy.partOfSpeech,
    definitions: entryCopy.definitions,
    example: entryCopy.example,
    etymology: entryCopy.etymology,
    image: `images/${filename}`,
    caption: entryCopy.caption,
    tags: entryCopy.tags,
    photographer: chosen.photographer,
    photographerUrl: chosen.photographerUrl,
    unsplashUrl: chosen.unsplashUrl,
  };
  entries.unshift(entry);
  await fs.writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2));
  console.log(`Saved entry: ${entry.word}`);

  // Step 7: build the per-entry HTML page and refresh the sitemap
  const entryPagePath = await buildEntryPage(entry);
  console.log(`Built entry page: ${path.relative(ROOT, entryPagePath)}`);
  await buildSitemap(entries);
  await buildRssFeed(entries);
  console.log(`RSS feed rebuilt.`);
  console.log(`Sitemap rebuilt with ${entries.length} entries.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
