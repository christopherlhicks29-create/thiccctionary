/**
 * caption.js - the plate caption, written for the photograph that is actually
 * on disk.
 *
 * Wave 329. Found while verifying the 2026-05-14 Kettledrum reshoot. The entry
 * now carries a photograph of two copper timpani against a brick wall, and the
 * caption under it reads "Close-up of a drum head, showcasing its substantial
 * acoustic potential." That is a faithful description of the photograph the
 * regen had just deleted.
 *
 * The cause is an ownership gap that both scripts documented and neither
 * closed. regenerate-text.js says so in as many words: "Wave 147 gave every
 * image-side field to regenerate-images.js, so this script writes text fields
 * only", and it discards the caption the model hands it. regenerate-images.js
 * writes image, photographer, photographerUrl and unsplashUrl, and does not
 * mention the caption anywhere in the file. So the caption is owned by neither.
 * The only thing that has ever written one is the original generate-daily run,
 * which means every entry whose photograph has since been replaced is
 * describing a picture no reader can see.
 *
 * This is the repo's recurring bug with a new label: the fact "what the
 * photograph shows" is stored in two places, the photograph and the prose under
 * it, and only one of them gets updated. The fix is the usual one -- the thing
 * that changes the photograph is the thing that must rewrite the sentence
 * describing it.
 *
 * Three layers, each falling back to the next, because this runs unattended at
 * the far end of a workflow and a caption is never worth failing a replacement
 * over:
 *
 *   1. Ask the model for a caption in the house voice, given the headword and
 *      the critic's own account of what the photo depicts.
 *   2. If that is unavailable or comes back in a voice the brand rules reject,
 *      build one deterministically from the critic's photoSubject. Flat, but
 *      true, and true beats witty-and-wrong under a photograph.
 *   3. If even that trips the banned-words filter, return null and let the
 *      caller keep the old caption and log it for a human. A wrong caption is
 *      bad; a caption that breaks the editorial rules is worse, and this path
 *      is the only one nobody has read before it ships.
 *
 * The plate number is not this file's business. plate.js owns it, and the
 * caller runs the result through withPlateNumber().
 *
 * ---
 *
 * Wave 329b, written the same day, after the first caption this file ever
 * shipped in production. The 2026-07-17 Honeydew reshoot landed a single pale
 * melon on a plain grey sweep -- nothing else in the frame at all -- and the
 * model wrote "A sizeable honeydew melon posed with confidence on an elaborate
 * silver serving platter, for grandeur." There is no platter. There is no
 * silver. The evidence it was handed said "a whole honeydew melon" and "round
 * brown fruit placed on white surface", and it furnished the room anyway.
 *
 * So Wave 329 traded a stale caption for an invented one. Same defect class --
 * prose describing a photograph the reader cannot see -- with a new cause. The
 * lesson from 328f applies directly and was ignored here at first: adding "do
 * not invent detail" to the prompt is the same move as adding "stand" to
 * criterion 8's exclusion list, and that did not work either. The repo's own
 * rule is to ask the model for what it does well and do the checking in code.
 *
 * What it does well is voice. What it cannot be trusted with is the contents of
 * the frame. So the model may only re-say, in the house voice, things already
 * present in the evidence: the headword, the critic's photoSubject, and
 * Unsplash's own description. Every other content word in its caption must come
 * from a fixed lexicon of voice and function words -- posture, scale, rhetoric,
 * grammar -- and never a thing. "in majestic repose" survives. "silver serving
 * platter" does not, because platter is a noun about the world and nothing in
 * evidence mentions one.
 *
 * The check fails safe by construction. A voice word missing from the lexicon
 * costs one dry caption; an ungrounded noun costs a lie under a photograph.
 * That asymmetry is the whole argument for keeping the lexicon tight and
 * letting it reject more than it strictly must.
 */
import { openaiChat, extractJson } from '../openai-with-fallback.js';
import { findBannedTerms } from '../banned-words.js';

/**
 * The critic is asked whether the photo shows a REAL example of the subject, as
 * opposed to a toy, a sculpture, or a drawing, and it answers in the phrase:
 * "a real pair of copper timpani drums", "a real high-voltage transformer".
 * That word answers our question, it does not describe the object, and it reads
 * as a defensive tic under a photograph. The model path is told the same thing
 * in its prompt; this strips it from the deterministic one.
 *
 * The leading article goes with it, and unconditionally, for two reasons. It
 * dodges the a/an agreement problem that stripping only the hedge creates ("an
 * actual cast iron kettle" would leave "an cast iron kettle"), and an article
 * is not how a plate label in an illustrated dictionary reads anyway: the
 * existing hand-written captions are "The contrabass tuba, in majestic repose"
 * and "Rear tire of agricultural machinery", not "A rear tire of...".
 */
const HEDGES = /^(?:an?|the)\s+(?:(?:real|actual|genuine|authentic)\s+)?/i;

/** Sentence-case without touching an already-capitalised proper noun. */
function sentenceCase(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1);
}

/**
 * A caption built from the critic's description alone. No network, no model,
 * no failure mode. This is what the whole file degrades to.
 */
export function captionFromSubject(photoSubject) {
  const body = sentenceCase(String(photoSubject || '').trim().replace(HEDGES, '').replace(/[.\s]+$/, ''));
  if (!body) return null;
  return `Plate N., ${body}.`;
}

/**
 * Words the caption may use that describe no object: grammar, posture, scale,
 * and the dry-archival rhetoric the house voice runs on. Deliberately does NOT
 * contain scene nouns. "stands" is absent while "standing" is present, because
 * one is a posture and the other is a thing a timpani sits on, and this file
 * cannot tell them apart. Anything not here and not in the evidence is treated
 * as invention.
 */
const VOICE_LEXICON = new Set(`
plate n a an the of in on at to for from with and or but its it their his her
this that these those is are was were be being been as by into upon over under
no not all one two three both each other another same such some any more most
very quite rather than entirely wholly merely simply also here alone itself
themselves well nor if while though although yet still even so thus hence
repose reposing majestic majesty majestically dignity dignified stately
stateliness grandeur solemn solemnity gravity gravitas ceremony ceremonial
occasion apology apologetic unapologetic unapologetically unembarrassed
unbothered confidence confident confidently conviction presence bearing aspect
demeanour demeanor countenance composure poise candour candor
specimen example exemplar subject article item object entry plate figure
shown depicted pictured photographed presented exhibited displayed observed
recorded catalogued cataloged noted rendered seen captured sitting standing
resting reclining lounging posed posing poised placed set arranged awaiting
attended flanked accompanied surrounded framed centred centered
large larger largest considerable substantial sizeable sizable ample generous
immense vast great greater notable uncommon unusual remarkable imposing
monumental prodigious formidable handsome fine full whole entire complete
girth circumference bulk mass proportion proportions dimension dimensions
magnitude heft scale reference comparison purpose purposes measure
lesser greater ordinary common modest unremarkable diminished reduced
without within against beside beneath above below among amongst amid amidst
faintly duly properly apparently evidently seemingly plainly frankly
`.trim().split(/\s+/));

/** Crude singular/participle folding, so "drums" matches "drum". */
function fold(token) {
  return token.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '').replace(/(?:ing|ed)$/, '');
}

function bagOf(text) {
  const bag = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z]+/)) {
    if (!raw) continue;
    bag.add(raw);
    bag.add(fold(raw));
  }
  return bag;
}

/**
 * Content words in `caption` that appear neither in the supplied evidence nor
 * in the voice lexicon. An empty array means every claim the caption makes is
 * one somebody who looked at the photograph already made.
 */
export function ungroundedWords(caption, evidence) {
  const known = bagOf(evidence);
  const out = [];
  for (const raw of String(caption || '').toLowerCase().split(/[^a-z]+/)) {
    if (!raw || raw.length < 3) continue;
    const f = fold(raw);
    if (VOICE_LEXICON.has(raw) || VOICE_LEXICON.has(f)) continue;
    if (known.has(raw) || known.has(f)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

const SYS_PROMPT = `You write the caption that sits under a plate in a mock Victorian illustrated dictionary of thiccc objects. The joke is that the reference work is entirely straight-faced about an absurd subject.

Rules:
- ONE sentence. Under 20 words. Begin it with the literal text "Plate N., " and leave N as the letter N.
- Describe the photograph that is in front of you. A reader looking at the picture must recognise it from your sentence.
- You have not seen the photograph. You have only the two descriptions below. Name NO object, surface, material, colour or setting that those descriptions do not name. If they say a melon and nothing else, your caption is about a melon and nothing else. An invented platter, table, shelf or backdrop is the one failure that gets a caption thrown away.
- Dry, archival, faintly pompous. "in majestic repose", "posing without apology", "provided for scale rather than for shelter".
- Never mention people, bodies, or body parts, even in metaphor. Never use the words curves, curvy, voluptuous, hourglass, or thicc/thicc-adjacent slang.
- No marketing language, no exclamation marks, no emoji, no em dashes.
- Do not explain the joke.

Output JSON: {"caption": "Plate N., ..."}`;

/**
 * A caption for a freshly-replaced photograph.
 *
 * Returns a string beginning "Plate N., " (the caller numbers it), or null when
 * every layer has been refused -- which the caller must treat as "keep what is
 * already there", not as "write an empty caption".
 *
 * `chat` is injected so the layering can be tested without a network or a key.
 * `notes` is an array this pushes human-readable rejections into, so the caller
 * can put them in the audit file rather than in a console line nobody can read.
 */
export async function writeCaption({ word, photoSubject, photoDescription, chat, notes } = {}) {
  const fallback = captionFromSubject(photoSubject || photoDescription);
  const send = chat || openaiChat;
  const note = (m) => { if (Array.isArray(notes)) notes.push(m); console.warn(`[caption] ${m}`); };
  const evidence = [word, photoSubject, photoDescription].filter(Boolean).join(' ');

  let modelCaption = null;
  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || chat) {
    try {
      const res = await send({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: `Headword: ${word || '(unknown)'}
What the photograph actually depicts, per the vision critic: ${photoSubject || '(not recorded)'}
Unsplash's own description of it: ${photoDescription || '(none)'}

The critic says "real" to mean "not a toy or a sculpture". Do not carry that word into the caption.` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.8,
        }),
      });
      if (res && res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(extractJson(data.choices[0].message.content));
        const c = String(parsed.caption || '').trim();
        if (c) modelCaption = c;
      } else if (res) {
        note(`chat returned ${res.status}, falling back to the critic's description.`);
      }
    } catch (e) {
      note(`errored (${e.message}), falling back to the critic's description.`);
    }
  }

  // Only the model path is checked for groundedness. The deterministic one is
  // grounded by construction -- it is the critic's own sentence with an article
  // trimmed -- so running it through the same filter could only ever produce a
  // false positive that costs us the last caption we have.
  if (modelCaption) {
    const invented = ungroundedWords(modelCaption, evidence);
    if (invented.length) {
      note(`refused "${modelCaption}": nothing in evidence supports ${invented.join(', ')}.`);
      modelCaption = null;
    }
  }

  for (const candidate of [modelCaption, fallback]) {
    if (!candidate) continue;
    const violations = findBannedTerms({ caption: candidate });
    if (violations.length === 0) return candidate;
    note(`rejected "${candidate}" (${violations.map((v) => v.term).join(', ')}).`);
  }
  return null;
}
