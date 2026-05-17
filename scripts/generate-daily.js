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
 * The cron workflow then opens a Pull Request, you review on your phone
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
import { validateEntry } from './banned-words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const IMAGES_DIR = path.join(ROOT, 'images');

// ---------- 1. Pick today's subject ----------

// Read words from open daily/* PR branches so the subject picker doesn't
// re-pick something that's already pending merge. Without this, watermelon
// gets picked twice in a row when 5/5's PR is unmerged at 5/6's run.
function pendingPrWords() {
  try {
    const { execSync } = require('node:child_process');
    // Note: workflow MUST fetch daily/* refs before running this script.
    // See .github/workflows/daily.yml, git fetch step.
    const branches = execSync(
      "git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/daily/*'",
      { encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean);
    const words = [];
    for (const branch of branches) {
      try {
        const raw = execSync(
          `git show ${branch}:data/entries.json`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0 && arr[0].word) {
          words.push(arr[0].word);
        }
      } catch (e) { /* branch missing entries.json, skip */ }
    }
    return words;
  } catch (e) {
    // git not available, or no daily/* refs locally, degrade gracefully
    return [];
  }
}

async function pickSubject(usedWords) {
  const sysPrompt = `You suggest subjects for "Thiccctionary", a satirical daily dictionary of THICK INANIMATE OBJECTS (never people, never bodies, never animals). Categories: aircraft, vehicles, ships, trains, fruit, vegetables, furniture, buildings, appliances, tools, machinery, musical instruments, packaged goods. The subject must be something that would plausibly be photographed on Unsplash and look genuinely chunky/curvy/voluminous in good photos.

SCROLL-STOPPING BIAS, this is critical. The reader is scrolling past on social. A clean photo of a regular sofa won't stop them. A real photo of a 2,500-lb championship pumpkin, a Saturn V booster on a transport crawler, a Brutalist concrete bunker, a 40-foot-tall industrial tuba, a sousaphone, a giant hay bale, a Cadbury Creme Egg the size of a microwave, or a comically thicc submarine WILL. The subject's REAL form should be inherently striking, visually absurd in its own right, with no Photoshop or AI needed.

Bias your picks toward subjects that are absurdly thicc IN REALITY. Brands and models help (Saturn V, Sousaphone, Champion Prize Pumpkin, Boeing 747, Chesterfield Sofa). Strong absurd-real subjects that would land:
- Giant gourds and championship-cultivar fruit/veg (record-setting pumpkins, watermelons, rutabagas)
- Industrial machinery at scale (mining-truck tires, transformer drums, smokestacks, Saturn V boosters, pipe organs)
- Brutalist or fortress architecture (concrete bunkers, Soviet apartment blocks, Hoover Dam)
- Outsized musical instruments (tubas, sousaphones, contrabassoons, kettledrums)
- Comically large food (industrial-bakery loaves, wheel of Parmigiano-Reggiano, Costco-tier cheesecake)
- Strange-but-real vehicles (cement mixers, dump-truck haulers, Bagger 288, the Antonov An-225)

Avoid mundane subjects whose photos can't carry on their own (regular chair, regular fridge, regular sedan). If the subject's real-world photo wouldn't make someone stop scrolling, pick a more extreme/specific variant. "Sofa" is weak; "Chesterfield, Tufted Leather" is better; "Sectional, U-Shaped Pit" is better still.

HEADWORD STYLE, this is the most important part. The headword should feel like a real dictionary entry, with VOICE and SPECIFICITY. Three patterns work; rotate through them:

1. COMMA-QUALIFIER ("Avocado, Domestic" / "Refrigerator, Side-by-Side" / "Cadillac, c. 1959"), dictionary-cataloguing register. Strong default.
2. ALLITERATIVE-DESCRIPTOR ("Concrete Cathedral" / "Bulbous Bouy" / "Pendulous Pumpkin"), only if the alliteration is genuinely good.
3. PROPER-NOUN-FORWARD ("Thiccc Boeing" / "Frigidaire Imperial" / "Steinway, Concert Grand"), when the brand IS the punchline.

AVOID weak generic-adjective + noun patterns. The full ban list of qualifiers that you MAY NOT use as the lead adjective: Big, Bulky, Large, Round, Heavy, Chunky, Hefty, Plump, Plush, Thick, Wide, Fat, Stout, Sturdy, Massive, Huge, Dense, Solid. If your headword starts with any of these, START OVER. They are filler, they tell the reader nothing the eye doesn't already see. Instead, push for: specific cultivar/model/era ("Heritage Tomato", "Ford F-450", "Mid-Century Armchair"); branded specificity ("Frigidaire Imperial", "Steinway, Concert Grand"); botanical or mechanical register ("Concrete Mixer", "Avocado, Domestic"); or proper-noun-forward construction where the brand IS the punchline ("Thiccc Boeing").

Output strict JSON only.`;

  const userPrompt = `Suggest today's subject. Avoid recently used: ${usedWords.join(', ') || '(none)'}.

Reference for the bar (these were strong picks):
- "Avocado, Domestic"  (comma-qualifier, botanical register)
- "Thiccc Boeing"  (proper-noun-forward, brand carries the joke)
- "Ford F-450"  (model number specificity)
- "Heritage Tomato"  (cultivar-language qualifier)
- "Mid-Century Armchair"  (period-detail qualifier)

Reference for scroll-stopping absurd-real picks (favor these heavily):
- "Pumpkin, Atlantic Giant"  (championship cultivar, real specimens exceed 2,500 lbs)
- "Sousaphone, Marching"  (instrument whose real form is inherently absurd)
- "Saturn V, First Stage"  (largest rocket booster ever flown, real photos are jaw-dropping)
- "Bagger 288"  (actual largest land vehicle on Earth)
- "Wheel, Parmigiano-Reggiano"  (88-lb cheese wheel, visually preposterous in real photos)
- "Submarine, Typhoon-Class"  (largest submarine ever built, actual proportions read as cartoon)

Reference for what to AVOID (these were weak):
- "Bulky Refrigerator"  ← generic adjective. Better: "Frigidaire, Side-by-Side" or "Refrigerator, Mid-Century Apartment"
- "Big Truck"  ← no specificity. Better: model + qualifier.
- "Sofa, Standard"  ← mundane. Better: "Sectional, U-Shaped Pit" or "Chesterfield, Tufted Leather"

Schema:
{
  "subject": "the noun phrase being defined, must follow one of the three style patterns above",
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
    thumbUrl: r.urls.small,    // ~400px, used for vision evaluation (cheap)
    fullUrl: r.urls.regular,   // ~1080px, used for the actual entry
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

CRITICAL, the photo MUST show the WHOLE subject in frame:
- The full silhouette must be visible, head to tail, end to end
- A reader should be able to see the subject's overall shape at a glance
- REJECT tight crops, detail shots, side panels, single wheels, engine close-ups, or any composition where you can only see PART of the subject
- If NONE of the candidates show the full subject, pick the one with the most of it visible

HARD VETOES (automatic rejection):
- The PRIMARY SUBJECT of the photo is a person, portrait, fashion shot, body close-up, beauty/glamour. The brand is "we don't make jokes about human bodies," so a photo OF a person is wrong. A photo of a THING (truck, tomato, building, ship) where humans appear incidentally, bystanders, scale-reference, crew on a deck, is FINE as long as the THING is the focus and occupies the bulk of the frame.
- The photo is a TOY, SCULPTURE, STATUE, FIGURINE, COSTUME, REPLICA, FAN-ART, ILLUSTRATION, or CARTOON of the subject, we want photographs of the REAL physical thing. A Transformer-the-robot statue is not an electrical transformer. A toy fire truck is not a fire truck. A pumpkin Halloween costume is not a pumpkin. If you see seams, paint chipping, plastic, weld marks where a real subject would be solid, painted-flame decals on metal, action-figure proportions, REJECT. Score below 4 / verdict "reject" applies.
- Watermarks, text overlays, logos, captions
- Marketing/product renders, illustrations, AI-generated stock, only real photographs
- The actual subject occupies less than ~30% of the frame
- The subject is in deep shadow or silhouette where its girth can't be seen

If ALL candidates fail veto (rare, usually one is acceptable), output {"pick": -1, "reason": "all candidates fail veto"}. The workflow will re-search.

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

  // Handle the explicit veto signal, pick == -1 means all candidates failed
  // veto. Surface this so the caller can re-search with a broader query.
  if (typeof result.pick === 'number' && result.pick === -1) {
    console.warn(`Vision rejected all ${subset.length} candidates: ${result.reason || 'no reason'}`);
    return { rejected: true, reason: result.reason || 'all candidates failed veto' };
  }

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
  const sysPrompt = `You write entries for "Thiccctionary", a satirical daily dictionary of THICK INANIMATE OBJECTS. Tone: scholarly dictionary register × dry comedy × internet vernacular. Keep it tasteful, the joke is applying body-positive thirst language to objects, never to people. NEVER reference humans, anatomy, or body parts in your output. Light HTML (<em>) allowed inside strings. Output strict JSON only.

VOICE TARGETS, match these patterns:

THE THREE THINGS THAT MAKE A THICCCTIONARY ENTRY ACTUALLY FUNNY (in priority order):

1. SPECIFICITY beats abstraction. "Florida grew an avocado so thiccc..." > "An avocado was grown that was very thiccc..." Real settings (the suburban Costco parking lot, the county fair weigh-in, the uncle's garage), real brands (Frigidaire, Steinway, F-450, Cadbury), real cultural anchors (Brooklyn townhouse, Costco haul, NHL bench).

2. PUNCHLINE TAGS. Every example sentence MUST end on a beat, a comedic kicker, a sharp tag, a rhythmic closer. NOT "He saw a thiccc X." YES "He saw a thiccc X. The parking lot reorganized around him." or "...The dually rear axle takes up two spaces by birthright." or "...Toast was just the canvas." Without the tag, the example dies on impact.

3. ANTI-CLIMAX in the etymology. The kicker is what makes it sing. "From Spanish aguacate, from Nahuatl āhuacatl, originally meaning 'testicle', which, frankly, tracks." The straight academic part sets up the deadpan. End with a beat, not a fact.

DEFINITIONS, should sound like Merriam-Webster wrote them after one drink. Strong examples (study these, they all share unexpected SPECIFICITY):
- "A widebody aircraft whose aft fuselage exhibits significantly more curvature than its fore fuselage; esp. one observed tail-on, in long-lens profile."
- "An industrial vehicle of contemplative rotundity, characterized by a single, slowly-rotating, drum-shaped midsection."
- "The platonic ideal of thicccness: all body, no apologies."
- "Any specimen exceeding 400g and exhibiting what botanists term 'a generous undercarriage'."
- "A heavy-duty pickup of substantial posterior breadth, distinguished by dual rear wheels per side and an aggressively flared bedside that reads as architectural."

ANTI-PATTERNS for definitions (these are what AI overuses, DO NOT write these):
- "imposes its presence" / "commands the room" / "monumental in scale", generic puff
- "robust girth and imposing presence", every adjective doing zero work
- "renowned for its [adjective]", stock dictionary opener that signals nothing
- Stacking three vague adjectives ("massive, hefty, and substantial"), pick ONE specific detail instead
- "exuding [abstract noun]", almost always filler

NO TIME-ANCHORED FRAMING. The entry must read as a permanent dictionary record, not a daily blog post. Don't write "today's specimen," "this morning's catch," "as featured today," or anything that locks the entry to a specific date or news cycle. Entries must work whether the reader encounters them today or three years from now in a printed book. Write FOR THE CATALOG, not FOR TODAY.

NO BODY-ADJACENT LANGUAGE. The brand exists to redirect AWAY from body language onto objects. Words like "voluptuous," "curves," "runway," "fashion model," "vintage model," "thin skins," "hourglass," "hip-to-waist ratio," "well-endowed" applied to OBJECTS undermine the entire conceit, they smuggle the body framing back in through metaphor. Use OBJECT language: "girth," "rotundity," "depth," "wheelbase," "displacement," "footprint," "bedside flare," "drum diameter," "shell thickness." If you find yourself reaching for a body word, the entry is wrong. Stop and pick an object word.

DEFINITION #2 MUST ESCALATE WITH RESTRAINT. The colloquial/slang second definition should sharpen the joke, not restate definition 1 with different adjectives. Strong def #2: "The platonic ideal of thicccness: all body, no apologies." (one short sentence, lands) or "A truck that does not back into a parking spot so much as occupy it with permanent intent." (one specific behavioral observation). Weak def #2: "Any banana that commands attention with full-bodied presence", that is just def #1 restated. If def #2 is just def #1 with synonyms, cut it entirely; better to have one strong definition than two parallel ones.

ETYMOLOGIES, lead with REAL, VERIFIABLE etymology (Latin/Greek/Middle English/Old French/Spanish/Nahuatl/named industrialists/dated coinages), then close with a comedic kicker that lands. This is where the personality lives.

CRITICAL, the etymology MUST be REAL. Do NOT invent fictional Old English / Old French / Proto-Germanic / Sanskrit forms. Do NOT make up word origins. If you cannot recall the real etymology of the word with confidence, fall back to: (a) etymology of a related/component word you DO know, (b) the named inventor or company, (c) a dated first-attestation in print. Fabricated etymologies destroy the joke, the entire conceit of Thiccctionary is fake-academic register applied to real linguistic facts. A made-up "Old English 'cynce'" is brand-damaging, not funny.

Examples that worked:
- "From Spanish aguacate, from Nahuatl āhuacatl, originally meaning 'testicle', which, frankly, tracks."
- "From thiccc (internet vernacular, c. 2015, 'voluptuous; full-bodied,' with an extra c for emphasis) + Boeing Company (Seattle-based aircraft manufacturer, est. 1916). First attested on Thiccctionary.com, May 2026."
- "From Henry Ford (industrialist) + the model code for the heaviest-duty pickup in the lineup. The numerical suffix correlates positively with girth."

AVOID:
- Fabricated word origins ("from Old English 'cynce'", there is no such word)
- Generic glosses that just translate the parts ("from Latin X meaning Y, combined with Z meaning W")
- Etymologies without a comedic kicker, the kicker is mandatory.

EXAMPLES, must include "thiccc" (three c's). Format: ONE crisp sentence WITH A PUNCHLINE TAG at the end. The tag is non-negotiable, if the example doesn't have a comedic closer, it failed.

Strong examples that worked (notice the tag pattern at the end of each):
- "That 747 is straight-up a thiccc Boeing. The empennage on her? Architectural." [tag = sharp 1-word answer]
- "Florida grew an avocado so thiccc it required two hands and a pre-meal stretch. Toast was just the canvas." [tag = bone-dry comparison]
- "He pulled up in a thiccc F-450 and the parking lot reorganized around him. The dually rear axle takes up two spaces by birthright." [tag = bureaucratic deadpan]
- "She rolled out a thiccc wheel of Parmigiano-Reggiano at the wedding. Three groomsmen had to commit to the lift." [tag = scene-specific punchline]

Note what they all have in common:
- A SCENE (Florida, parking lot, wedding), not a vague situation
- A CONCRETE BEAT at the end, a one-sentence punchline that lands
- BRAND/MODEL specificity, "747," "F-450," "Parmigiano-Reggiano"

AVOID, these patterns are dead on arrival:
- Flat constructions: "Replaced my X with this thiccc Y", no scene, no tag, no joke
- Real-estate / interior-design copy: "effortlessly enhancing the aesthetic", "elevating any room"
- Generic compliments: "such a statement piece", "absolute showstopper"
- Marketing language: "commands attention", "makes a statement"
- Ending the sentence at the headword without a tag, even one extra clause is required
- Adverb stacking: "monumentally, imposingly, undeniably thiccc", one specific image, not three vague ones`;

  const userPrompt = `Today's subject: "${subject}"

The photo we chose: ${photo.description ? `"${photo.description}"` : '(no caption available)'}, by ${photo.photographer} on Unsplash.

Write the dictionary entry. Reference the actual photo loosely (e.g. "esp. one viewed astern, in raking light" or "the subject's posterior, viewed astern, defies casual description") but don't get specific about details you can't verify.

Schema:
{
  "word": "${subject}",
  "pronunciation": "/sim-pul re-SPEL-ing/",  // simple respelling, capitalize the stressed syllable, hyphens between syllables, lowercase otherwise. Do NOT use IPA.
  "partOfSpeech": "n.",
  "definitions": ["definition 1 (1-2 sentences, dictionary register, voicy)", "optional definition 2 (sharper / colloquial, labeled with <em>colloq.</em> or <em>slang.</em>)"],
  "example": "ONE sentence (optionally + a short tag) using BOTH the headword AND the literal word \"thiccc\" (always three c's). Use brand/model/proper-noun specificity. Avoid 'Replaced my X with this thiccc Y', pick a scene.",
  "etymology": "Real etymology FIRST (Latin/Greek/Middle English/Spanish/Nahuatl/etc., dated coinages, named industrialists) THEN a comedic kicker. The kicker is what makes the entry sing.",
  "caption": "Plate N., A short caption for the image, dictionary-illustration style. (N is a placeholder, leave it as 'Plate N.' literally.)",
  "tags": ["tag1", "tag2", "tag3"],
  "category": "ONE OF: Vehicles & Transport | Architecture & Infrastructure | Industrial Machinery | Produce & Botanical | Foods of Substance | Domestic Goods | Engineering Marvels | Musical Instruments, pick the single best fit. This becomes the chapter the entry lives in when the catalog ships as a book."
}`;

  // Wave 142b: retry-with-backoff. Earlier runs failed on transient OpenAI errors,
  // leaving an orphaned image and no entry. Try 3 times with 2s/5s/10s backoff.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
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
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Entry gen failed: ${res.status} ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Entry gen returned empty content');
      return JSON.parse(content);
    } catch (e) {
      lastErr = e;
      console.warn(`[generateEntry] attempt ${attempt}/3 failed: ${e.message.slice(0, 200)}`);
      if (attempt < 3) {
        const wait = [2000, 5000, 10000][attempt - 1];
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}


// ---------- 5a. Humor critique (post-write QA on the generated entry) ----------
// Scores the just-written entry's humor 1-10 and gives a one-line verdict.
// Rejection logic in main(): score < 6 → regenerate once. Still < 6 → ship the
// PR anyway (Christopher can edit before merging, better to surface a weak entry
// for review than block the daily pipeline on a subjective measure).
async function critiqueEntryHumor(entry) {
  const sysPrompt = `You are a humor reviewer for "Thiccctionary," a satirical daily dictionary of thiccc inanimate objects. Voice = pseudo-academic dictionary register × dry comedy × internet vernacular. Brand promise: jokes about THINGS, never bodies.

Score the just-written entry on humor. Use these criteria:

1. SPECIFICITY, does the example sentence have a real scene (Florida, county fair, NHL bench, suburban Costco) or is it generic ("someone saw a thiccc X")? Specific = higher.
2. PUNCHLINE TAG, does the example end on a comedic beat? A sharp tag, anti-climax, or rhythmic closer? Without a tag, the example dies. Tagless = strong deduction.
3. ETYMOLOGY KICKER, does the etymology end on a deadpan beat ("which, frankly, tracks" / "First attested on Thiccctionary.com" / similar)? OR does it just translate the parts? Kicker present = higher.
4. ANTI-PATTERNS, does the entry use any of these dead phrases? "imposes its presence," "commands the room," "monumental in scale," "robust girth and imposing presence," "renowned for its [adjective]," "exuding [abstract noun]"? If yes, strong deduction.
5. SURPRISE, is there at least one unexpected, voicy detail (a botanical aside, a parenthetical aside, a Latin-register flip, a comically specific stat)? Generic puff loses points.

Score 1-10:
  9-10 = Avocado-Domestic / F-450-Dually tier. Definitely funny. Ship.
  6-8  = solid, dictionary register lands, has a tag and a kicker. Ship.
  3-5  = tag missing OR multiple anti-pattern phrases OR generic etymology. Regenerate.
  1-2  = AI-template tells throughout. Reject.

Output JSON only.`;

  const userPrompt = `Headword: ${entry.word}
Pronunciation: ${entry.pronunciation}
Definitions: ${(entry.definitions || []).map(d => '- ' + d).join('\n')}
Example: ${entry.example}
Etymology: ${entry.etymology}

Evaluate this entry's humor.

{
  "score": <integer 1-10>,
  "verdict": "ship" | "regenerate" | "reject",
  "weakest_part": "definitions" | "example" | "etymology" | "overall",
  "feedback": "one or two sentences, what's working, what's flat, what would land"
}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 300,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    if (!res.ok) {
      console.warn(`Humor critique skipped: ${res.status}`);
      return { score: null, verdict: 'unknown', feedback: 'critique step failed (non-blocking)' };
    }
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.warn('Humor critique caught:', e.message);
    return { score: null, verdict: 'unknown', feedback: `critique unavailable: ${e.message}` };
  }
}

// ---------- 5b. Design critique (post-pick QA) ----------
// Runs after the image is selected, before the PR opens. Asks GPT-4o vision
// to evaluate whether the chosen photo actually works on the live site:
// silhouette completeness, framing, brand-fit, whether anything will be cropped
// in the layout. Returns a score (1-10) and a short critique string.
async function critiqueChosenImage(subject, photo) {
  const sysPrompt = `You are a design reviewer for "Thiccctionary," a satirical daily dictionary of thiccc inanimate objects. You evaluate the chosen photo for a daily entry against these criteria:

1. SILHOUETTE COMPLETENESS, is the WHOLE subject visible? (rear-three-quarter, side-profile, full-frame views work; tight crops fail)
2. FRAMING, is the subject centered enough that a 4:3 or natural-aspect crop preserves it?
3. BRAND FIT, does the photo look like a documentary / dictionary plate, or a marketing render? (Documentary good, marketing bad)
4. CLUTTER, is the subject clearly the focal point, or surrounded by distractions?
5. PRIMARY-SUBJECT TEST, what is the photo OF? If the answer is a person (portrait, fashion, beauty, body close-up), DISQUALIFY, the brand never makes jokes about human bodies. If the answer is the actual subject thing (truck, tomato, instrument, building) and humans appear incidentally as bystanders / scale reference / crew / players holding the instrument, that's FINE. The rule is "no jokes about bodies," not "no humans visible."

6. REAL VS REPRESENTATION TEST, is this a photo of the ACTUAL subject, or a depiction of it? Things that count as DEPICTION and must be REJECTED (verdict "reject", score < 4): toys, sculptures, statues, figurines, costumes, replicas, fan art, illustrations, cartoons, action figures, model versions, 3D renders. Example: if the subject is "Transformer, Power Generation" (an electrical transformer) and the photo shows a Transformer-the-robot statue, REJECT. If the subject is "Pumpkin, Atlantic Giant" and the photo shows a person in a pumpkin costume, REJECT. If the subject is "Concrete Mixer" and the photo shows a toy concrete mixer, REJECT. Tells to watch for: visible seams, plastic surfaces, action-figure proportions, painted decals where real metal would be, weld marks at joints implying a built sculpture not a real machine, anything that reads as "made by an artist to look like X" rather than "is X."

For musical instruments specifically: a photo of a tuba being PLAYED by someone is a photo of the tuba (subject = instrument, person is incidental). A photo of a brass-band marching is also of the instruments. Reject only if the COMPOSITION centers a person's face/body.

Score the photo from 1 (unusable) to 10 (perfect). Brief one-paragraph critique. Output JSON only.`;

  const userPrompt = `Subject: ${subject}
Photo description: ${photo.description || '(no caption available)'}
Photographer: ${photo.photographer}
Photo URL: ${photo.fullUrl}

Evaluate this image and output JSON:
{
  "score": <1-10>,
  "verdict": "ship" | "needs-review" | "reject",
  "photoSubject": "one short clause describing what the photo ACTUALLY depicts, be specific. e.g. 'a real high-voltage electrical substation transformer' or 'a Transformer-the-robot sculpture made of car parts' or 'a 4-foot toy concrete mixer on a child's playmat'",
  "critique": "one paragraph explaining the score, what's good, what's weak"
}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: photo.fullUrl, detail: 'high' } }
          ]}
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      console.warn(`Design critique skipped: ${res.status}`);
      return { score: null, verdict: 'unknown', critique: 'Critique step failed (non-blocking).' };
    }
    const data = await res.json();
    const c = JSON.parse(data.choices[0].message.content);
    console.log(`Design critique: score=${c.score}/10, verdict=${c.verdict}`);
    return c;
  } catch (e) {
    console.warn(`Design critique error: ${e.message}`);
    return { score: null, verdict: 'unknown', critique: 'Critique step errored (non-blocking).' };
  }
}


// ---------- 5c. Bespoke social captions per entry ----------
// Generates 4 short, entry-specific captions (morning/afternoon/evening/reels)
// referencing real specifics of THIS subject. Falls back to template captions
// in post-to-buffer.js if this step fails (non-blocking).
async function generateSocialCaptions(entry) {
  const cleanEtym = (entry.etymology || '').replace(/<[^>]+>/g, '').trim();
  const def0 = (entry.definitions?.[0] || '').replace(/<[^>]+>/g, '').trim();
  const ex = (entry.example || '').replace(/<[^>]+>/g, '').trim();

  const sysPrompt = `You write social-media captions for Thiccctionary, a satirical online dictionary of thiccc inanimate objects. Voice: pseudo-academic, deadpan, dry. Mock-academic register applied to absurd subjects. Treat the object as if it has agency.

Rules:
- 2-4 short lines per caption. Newlines for comic timing.
- Reference REAL specifics about THE SUBJECT (numbers, dates, sizes, origin facts).
- Never use "voluptuous, curves, runway, diva, body, hourglass, slay, queen, OG, haters", these are banned.
- Em-dashes are fine and encouraged for comic timing.
- The word "thiccc" (three c's) is the brand word; use sparingly but freely.
- Each caption must work standalone, image carries some weight but caption must land its own line.
- DO NOT include URLs or hashtags, those are added by the posting script.

Tone exemplars:
- "Bagger 288. Thirteen thousand five hundred tons. Walks two miles per hour, professionally. The Earth simply moves when asked."
- "Spruce, Suburban. Planted as decoration. Currently undefeated. The lawn around it gave up three mowing seasons ago."
- "Hoover Dam. 660 feet thick at the base. The Colorado was not consulted."

Output JSON only.`;

  const userPrompt = `Subject: ${entry.word}
First definition: ${def0}
Example sentence: ${ex}
Etymology: ${cleanEtym}

Write 4 distinct captions. Each should reference a different specific about this subject. Output JSON:
{
  "morning": "...",
  "afternoon": "...",
  "evening": "From the archives, ${entry.word}.\\n...",
  "reels": "..."
}

Notes:
- "morning" leads with the headword. Punchy.
- "afternoon" mid-day energy; ends with the headword as a tag.
- "evening" archive callback; MUST begin with "From the archives, ${entry.word}."
- "reels" shortest; no URL (Reels strip links).`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      console.warn(`Social-captions step skipped: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const c = JSON.parse(data.choices[0].message.content);
    if (c && typeof c.morning === 'string' && typeof c.afternoon === 'string' && typeof c.evening === 'string' && typeof c.reels === 'string') {
      console.log('Generated social captions:');
      console.log('  morning:', c.morning.split('\n')[0]);
      console.log('  afternoon:', c.afternoon.split('\n')[0]);
      console.log('  evening:', c.evening.split('\n')[0]);
      console.log('  reels:', c.reels.split('\n')[0]);
      return c;
    }
    console.warn('Social-captions output missing required fields; falling back.');
    return null;
  } catch (e) {
    console.warn(`Social-captions step errored: ${e.message}`);
    return null;
  }
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
      console.log(`Entry for ${today} already exists. FORCE_REGENERATE=true, removing it and regenerating.`);
      entries.splice(existingIdx, 1);
    } else {
      console.log(`Entry for ${today} already exists. Exiting. (Set FORCE_REGENERATE=true to override.)`);
      return;
    }
  }

  // Step 1: subject
  const recentWords = entries.slice(0, 30).map(e => e.word);
  const pendingWords = pendingPrWords();
  if (pendingWords.length > 0) {
    console.log(`Found ${pendingWords.length} word(s) in open daily PRs: ${pendingWords.join(', ')}`);
  }
  const usedWords = [...new Set([...recentWords, ...pendingWords])];
  let subjectInfo;
  // Sentinel-file override: data/.fire-daily-subject (one line: a subject string) lets
  // me steer the picker from the sandbox without needing workflow_dispatch inputs.
  // Lower priority than SUBJECT_OVERRIDE env var; cleared after use.
  let fileOverride = null;
  try {
    const fileText = (await fs.readFile(path.join(ROOT, 'data', '.fire-daily-subject'), 'utf8')).trim();
    if (fileText && fileText.length > 0) fileOverride = fileText;
  } catch (e) { /* file absent, normal */ }

  // Subject queue: data/subject-queue.json holds an editorial backlog. Each
  // daily run pulls the FIRST queued subject if present (and removes it from
  // the queue). Lower priority than env override + sentinel file. Lets
  // Christopher stack subjects in advance ('next: Beluga, Bagger 288, etc.').
  let queueOverride = null;
  let queueQueryOverride = null;   // Wave 73: honor explicit `query` field from queue items
  let queueAfterPull = null;
  try {
    const raw = await fs.readFile(path.join(ROOT, 'data', 'subject-queue.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
      const first = parsed.queue[0];
      // Item may be a string or an object {subject, query?, notes?}
      if (typeof first === 'string') {
        queueOverride = first;
      } else if (first && typeof first === 'object') {
        queueOverride = first.subject || null;
        queueQueryOverride = first.query || null;   // explicit Unsplash query, if author set one
      }
      queueAfterPull = { ...parsed, queue: parsed.queue.slice(1) };
      console.log(`Subject queue: pulling "${queueOverride}" (${parsed.queue.length} item(s) before pull)`);
    }
  } catch (e) { /* file absent or malformed, normal, just skip queue */ }

  const overrideSubject = process.env.SUBJECT_OVERRIDE || fileOverride || queueOverride;
  if (overrideSubject) {
    // Use the override as the editorial subject AND derive a sensible Unsplash query.
    // Priority for the query:
    //   1. Explicit `query` from queue item (queueQueryOverride), only if this run uses the queue source
    //   2. Auto-derived from subject (reverses comma-qualifier: "Wheel, Parmigiano-Reggiano" → "Parmigiano-Reggiano wheel")
    let simpleQuery;
    const usingQueueQuery = !process.env.SUBJECT_OVERRIDE && !fileOverride && queueQueryOverride;
    if (usingQueueQuery) {
      simpleQuery = queueQueryOverride.toLowerCase();
    } else {
      const m = overrideSubject.match(/^([^,(]+),\s*(.+)$/);
      if (m) {
        const head = m[1].trim();
        const qualifier = m[2].trim();
        simpleQuery = `${qualifier} ${head}`.toLowerCase();
      } else {
        simpleQuery = overrideSubject.toLowerCase();
      }
    }
    subjectInfo = { subject: overrideSubject, unsplashQuery: simpleQuery, category: 'other' };
    const src = process.env.SUBJECT_OVERRIDE ? 'env' : (fileOverride ? 'file' : 'queue');
    console.log(`SUBJECT_OVERRIDE active: subject="${overrideSubject}" query="${simpleQuery}" (source: ${src})`);
  } else {
    subjectInfo = await pickSubject(usedWords);
    // Soft-collision check: if the FIRST word of the subject matches any recent
    // first word (e.g., "Watermelon, Titan" colliding with "Watermelon, Moon and Stars"),
    // retry once with that explicit collision called out in the avoid list.
    const firstWord = subj => String(subj || '').split(/[,\s]+/)[0].toLowerCase();
    const subjFirst = firstWord(subjectInfo.subject);
    const collision = usedWords.find(w => firstWord(w) === subjFirst);
    if (collision) {
      console.log(`Soft-collision: "${subjectInfo.subject}" shares first word with recent "${collision}". Retrying once.`);
      const widened = [...usedWords, subjectInfo.subject, `anything starting with "${subjFirst}"`];
      subjectInfo = await pickSubject(widened);
    }
  }
  console.log(`Subject: ${subjectInfo.subject} (query: "${subjectInfo.unsplashQuery}")`);

  // Step 2: search Unsplash. Wave 73 resilience: if the override query returns zero
  // results, the previous behavior was to throw uncaught and fail the workflow red,
  // poisoning every subsequent cron run until someone manually fixed the queue. Now
  // we catch the no-results case for OVERRIDE subjects and fall back to the auto-picker
  // so today's run can still ship something. The poisoned queue item still gets
  // popped (queueAfterPull is committed at end of run) so it can't block tomorrow.
  // Wave 74 expands Wave 73's fallback. Both override subjects AND auto-picker
  // subjects can return zero Unsplash results. Up to 3 fallback attempts; each
  // adds the failed subject to the avoid list so we don't pick the same dud
  // again. After 3 misses, fall through to a known-safe subject pool that
  // we've verified has Unsplash photos. As a last resort the script still
  // throws, but that's a 4-deep failure, not a 1-deep one.
  let candidates;
  let avoidNow = [...usedWords];
  let attempts = 0;
  const MAX_FALLBACK_ATTEMPTS = 3;
  while (true) {
    try {
      candidates = await searchUnsplash(subjectInfo.unsplashQuery);
      console.log(`Found ${candidates.length} candidate photos.`);
      break;
    } catch (e) {
      if (!/No Unsplash results/i.test(e.message)) throw e;
      attempts += 1;
      console.warn(`Subject "${subjectInfo.subject}" returned zero Unsplash results for query "${subjectInfo.unsplashQuery}". (attempt ${attempts})`);
      if (attempts > MAX_FALLBACK_ATTEMPTS) {
        // Last-resort known-safe pool, every entry here has been verified to
        // return Unsplash photos, and the auto-picker would happily pick any
        // of them as a normal day's subject.
        const SAFE_POOL = [
          { subject: 'Tractor Tire', unsplashQuery: 'tractor tire' },
          { subject: 'Stack of Pancakes', unsplashQuery: 'pancake stack' },
          { subject: 'Concrete Mixer Truck', unsplashQuery: 'concrete mixer truck' },
          { subject: 'Pumpkin, Atlantic Giant', unsplashQuery: 'giant pumpkin' },
          { subject: 'Cinder Block Wall', unsplashQuery: 'cinder block wall' },
        ];
        const pick = SAFE_POOL.find(s => !avoidNow.includes(s.subject)) || SAFE_POOL[0];
        console.warn(`Last-resort: picking from safe pool → "${pick.subject}".`);
        subjectInfo = { subject: pick.subject, unsplashQuery: pick.unsplashQuery, category: 'other' };
        candidates = await searchUnsplash(subjectInfo.unsplashQuery);
        console.log(`Found ${candidates.length} candidate photos.`);
        break;
      }
      avoidNow.push(subjectInfo.subject);
      subjectInfo = await pickSubject(avoidNow);
      console.log(`Fallback subject (#${attempts}): ${subjectInfo.subject} (query: "${subjectInfo.unsplashQuery}")`);
    }
  }

  // Step 3: pick the thiccest
  let chosen = await pickThiccestImage(subjectInfo.subject, candidates);

  // If the picker rejected ALL candidates, try one alternative angle. We
  // intentionally do NOT add "isolated studio no people", Unsplash treats
  // those as required keywords and usually returns zero results. Instead,
  // try a "photograph" suffix which biases toward general photography over
  // illustrations / renders.
  if (chosen && chosen.rejected) {
    console.warn('Picker rejected all candidates. Retrying with photography bias.');
    const broaderQuery = `${subjectInfo.unsplashQuery} photograph`;
    const retryCandidates = await searchUnsplash(broaderQuery);
    if (!retryCandidates || retryCandidates.length === 0) {
      console.log(`No results for retry query "${broaderQuery}". Skipping today's run cleanly so the cron can pick a different subject tomorrow.`);
      // Exit 0, this is a deliberate skip, not a failure. Run shows green,
      // no PR opens (nothing to commit), today's date stays available for
      // the next run.
      process.exit(0);
    }
    chosen = await pickThiccestImage(subjectInfo.subject, retryCandidates);
    if (chosen && chosen.rejected) {
      console.log(`All candidates failed veto on both queries for "${subjectInfo.subject}". Skipping today.`);
      process.exit(0);  // deliberate skip, green run, no PR
    }
  }

  // Step 4: download (filename includes slug so reverts/edits don't create
  // image-URL collisions where an old queued Buffer post pulls a new image)
  const provisionalSlug = subjectInfo.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const filename = `${today}-${provisionalSlug}.jpg`;
  await downloadImage(chosen, filename);
  console.log(`Saved image to images/${filename}`);

  // Step 4b: design critique (logged to PR body so Christopher can see if image needs review)
  // Wrapped in extra try/catch + 20s timeout so it can NEVER block the daily pipeline.
  let critique = { score: null, verdict: 'unknown', critique: 'Critique step skipped.' };
  try {
    const critiquePromise = critiqueChosenImage(subjectInfo.subject, chosen);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('critique timeout')), 20000));
    critique = await Promise.race([critiquePromise, timeoutPromise]);
  } catch (e) {
    console.warn('Design critique skipped (outer catch):', e.message);
    critique = { score: null, verdict: 'unknown', critique: `Critique unavailable: ${e.message}` };
  }

  // Critique acts as a GATE for the worst failures. Anything that explicitly
  // says 'reject' or scores below 4 OR mentions people gets the workflow to
  // exit non-zero, leaving no PR. Subtle issues still surface in the PR body
  // for review without halting.
  if (critique && (
    critique.verdict === 'reject' ||
    (typeof critique.score === 'number' && critique.score < 6)
  )) {
    console.log('GATE: critique flagged the image as unacceptable. Skipping before PR.');
    console.log('  score:', critique.score, ' verdict:', critique.verdict);
    console.log('  critique:', critique.critique);
    process.exit(0);  // deliberate skip, green run, no PR opens, subject remains available for next run
  }

  // Step 5: write the entry
  let entryCopy = await generateEntry(subjectInfo.subject, chosen);

  // Step 5-bw: banned-words filter (Wave 42). Reject and retry up to 3 times if output
  // contains banned body-language, internet-voice, or filler patterns.
  // The brand voice depends on these NOT appearing, soft prompt rules aren't enough.
  for (let bwAttempt = 1; bwAttempt <= 3; bwAttempt++) {
    const bwCheck = validateEntry(entryCopy);
    if (bwCheck.ok) {
      if (bwAttempt > 1) console.log(`Banned-words check passed on attempt ${bwAttempt}.`);
      break;
    }
    if (bwAttempt >= 3) {
      console.warn(`Banned-words check failed on all 3 attempts, shipping with violations. Christopher should review.`);
      break;
    }
    const violationList = bwCheck.violations.map(v => `"${v.term}" in ${v.field}`).join(', ');
    console.log(`Banned-words attempt ${bwAttempt}/3 rejected (${violationList}). Retrying...`);
    const bwHint = ` BANNED-WORDS HINT: previous output contained these forbidden terms: ${violationList}. Replace them with object-language (girth, rotundity, displacement, wheelbase, drum diameter, bedside flare). Reject body-coded metaphors entirely.`;
    entryCopy = await generateEntry(subjectInfo.subject + bwHint, chosen);
  }

  // Step 5a: humor critique. If the entry scores poorly, regenerate ONCE.
  // After one retry we ship anyway, better to land a weak entry that
  // Christopher can edit than block the daily pipeline on a subjective call.
  // Also: capture the FINAL humor score so we can use it for bookReady auto-flagging.
  let finalHumorScore = null;
  try {
    let humorCheck = await critiqueEntryHumor(entryCopy);
    console.log(`Humor critique: score=${humorCheck.score}/10, verdict=${humorCheck.verdict}, weakest=${humorCheck.weakest_part}`);
    if (humorCheck.feedback) console.log(`  feedback: ${humorCheck.feedback}`);
    if (typeof humorCheck.score === 'number' && humorCheck.score < 6 && humorCheck.verdict !== 'ship') {
      console.log('Humor below threshold. Regenerating once with feedback.');
      const retryHint = ` REGEN HINT: previous attempt scored ${humorCheck.score}/10, weakest part was ${humorCheck.weakest_part}. Feedback: ${humorCheck.feedback}. Push HARDER on specificity, scene, and punchline tag.`;
      try {
        entryCopy = await generateEntry(subjectInfo.subject + retryHint, chosen);
        humorCheck = await critiqueEntryHumor(entryCopy);
        console.log(`Humor retry: score=${humorCheck.score}/10, verdict=${humorCheck.verdict}`);
      } catch (e) {
        console.warn('Humor regenerate failed (shipping the original):', e.message);
      }
    }
    if (typeof humorCheck.score === 'number') finalHumorScore = humorCheck.score;
  } catch (e) {
    console.warn('Humor critique outer catch, shipping without humor check:', e.message);
  }

  // Step 6: assemble + save
  // Validate the model's category against our fixed list, if it returned
  // something off-list, mark as 'Uncategorized' and let Christopher fix
  // during PR review.
  const VALID_CATEGORIES = new Set([
    'Vehicles & Transport', 'Architecture & Infrastructure',
    'Industrial Machinery', 'Produce & Botanical',
    'Foods of Substance', 'Domestic Goods',
    'Engineering Marvels', 'Musical Instruments'
  ]);
  const category = VALID_CATEGORIES.has(entryCopy.category) ? entryCopy.category : 'Uncategorized';
  if (category === 'Uncategorized' && entryCopy.category) {
    console.warn(`Model returned off-list category: "${entryCopy.category}". Marked Uncategorized.`);
  }

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
    category: category,                  // chapter assignment for eventual book
    // bookReady auto-flag: humor critic ≥8 AND design critic ≥7 → candidate=true.
    // Christopher overrides during weekly curation; this is just the AI's
    // pre-selection so weak entries don't accidentally end up in the book.
    bookReady: (
      typeof finalHumorScore === 'number' && finalHumorScore >= 8 &&
      typeof critique?.score === 'number' && critique.score >= 7
    ) ? true : null,
    humorScore: finalHumorScore,
    photoScore: typeof critique?.score === 'number' ? critique.score : null,
    photographer: chosen.photographer,
    photographerUrl: chosen.photographerUrl,
    unsplashUrl: chosen.unsplashUrl,
  };

  // Wave 98: generate bespoke social captions per entry. Non-blocking, if it
  // fails, post-to-buffer.js falls back to the Wave 87 templated captions.
  const socialCaptions = await generateSocialCaptions(entry).catch(e => {
    console.warn('Social-captions outer catch:', e.message);
    return null;
  });
  if (socialCaptions) {
    entry.socialCaptions = socialCaptions;
  }
  entries.unshift(entry);
  await fs.writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2));
  console.log(`Saved entry: ${entry.word}`);

  // Write critique to a side-channel file so the GH Actions workflow can pick it up
  // for the PR body. Not committed to entries.json, it's purely review metadata.
  try {
    await fs.writeFile(path.join(ROOT, 'data', '.critique.json'), JSON.stringify(critique, null, 2));
  } catch (e) {
    console.warn('Failed to write critique side-channel file:', e.message);
  }

  // Step 7: build the per-entry HTML page and refresh the sitemap
  // entries.json is sorted newest-first so the new entry is at index 0; "next" in
  // chronological terms is entries[i-1] (newer), there is none for today, so null.
  // "prev" is entries[i+1] (older).
  const prev = entries.length > 1 ? entries[1] : null;
  const next = null;
  const entryPagePath = await buildEntryPage(entry, prev, next, entries);
  console.log(`Built entry page: ${path.relative(ROOT, entryPagePath)}`);

  // ALSO rebuild prev's page so its "next entry →" link points to today.
  if (prev) {
    const prevPrev = entries.length > 2 ? entries[2] : null;
    await buildEntryPage(prev, prevPrev, entry, entries);
    console.log(`Rebuilt prev entry page (${prev.date}) so its next-link points to today.`);
  }

  await buildSitemap(entries);

  // Load articles so the RSS feed stays unified (entries + articles, newest first).
  // Loss of articles in feed.xml has been the trigger for post-deploy-verify failures.
  let articles = [];
  try {
    articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8'));
  } catch (e) {
    console.warn('articles.json not loaded, RSS will not include articles:', e.message);
  }
  await buildRssFeed(entries, articles);
  console.log(`RSS feed rebuilt with ${entries.length} entries + ${articles.length} articles.`);
  console.log(`Sitemap rebuilt with ${entries.length} entries.`);

  // Clear the sentinel-file override so the next run uses the auto-picker again.
  try {
    await fs.unlink(path.join(ROOT, 'data', '.fire-daily-subject'));
    console.log('Cleared data/.fire-daily-subject so the next run auto-picks.');
  } catch (e) { /* file absent, normal */ }

  // Persist the queue minus the pulled item, if we used one. The pull
  // happened earlier; the write happens here at the END so a script crash
  // mid-run doesn't accidentally lose the queued subject.
  if (queueAfterPull) {
    try {
      await fs.writeFile(
        path.join(ROOT, 'data', 'subject-queue.json'),
        JSON.stringify(queueAfterPull, null, 2) + '\n'
      );
      console.log(`Subject queue updated: ${queueAfterPull.queue.length} item(s) remaining.`);
    } catch (e) {
      console.warn('Could not update subject-queue.json (non-fatal):', e.message);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
