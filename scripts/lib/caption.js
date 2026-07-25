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

const SYS_PROMPT = `You write the caption that sits under a plate in a mock Victorian illustrated dictionary of thiccc objects. The joke is that the reference work is entirely straight-faced about an absurd subject.

Rules:
- ONE sentence. Under 20 words. Begin it with the literal text "Plate N., " and leave N as the letter N.
- Describe the photograph that is in front of you. A reader looking at the picture must recognise it from your sentence.
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
 */
export async function writeCaption({ word, photoSubject, photoDescription, chat } = {}) {
  const fallback = captionFromSubject(photoSubject || photoDescription);
  const send = chat || openaiChat;

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
        console.warn(`[caption] chat returned ${res.status}, falling back to the critic's description.`);
      }
    } catch (e) {
      console.warn(`[caption] errored (${e.message}), falling back to the critic's description.`);
    }
  }

  for (const candidate of [modelCaption, fallback]) {
    if (!candidate) continue;
    const violations = findBannedTerms({ caption: candidate });
    if (violations.length === 0) return candidate;
    console.warn(`[caption] rejected "${candidate}" (${violations.map((v) => v.term).join(', ')}).`);
  }
  return null;
}
