/**
 * image-critic.js - the one image critic.
 *
 * critiqueImage({ subject, imageUrl, photoDescription, photographer })
 *   -> { isSubject, score, verdict, subjectPercentEstimate, photoSubject,
 *        strangerGuess, subjectBox, subjectPercentClaimed, critique }
 *   -> null if OPENAI_API_KEY is missing or the call fails outright.
 *
 * subjectPercentEstimate keeps its name but is no longer an estimate: as of
 * Wave 325 it is computed from subjectBox, and subjectPercentClaimed carries
 * whatever the model would have said. Four callers read the field and none of
 * them had to change. See withMeasuredProminence() below for why.
 *
 * Wave 204 extracted this from generate-daily.js "so regenerate-images.js and
 * post-to-buffer.js can use the same gate." generate-daily.js then kept its own
 * copy anyway, and for a hundred waves there have been two critics with two
 * prompts drifting apart: this one grew the GIRTH TEST and never got the Wave
 * 226 fabricated-model-number check; that one got the fabrication check and
 * never got girth. That one also got the Anthropic fallback wrapper, while this
 * one was still calling fetch() straight at OpenAI -- so an OpenAI quota outage
 * silently disabled the regen critic and, because passesGate(null) returns
 * true, left the gate wide open at exactly the moment the pipeline was already
 * degraded. Wave 321 merges them. There is one prompt now, and it goes through
 * openaiChat() like everything else.
 *
 * Wave 321 also adds criterion 0. The eight criteria that were here graded
 * composition and never asked whether the photograph was of the thing the entry
 * names. So "Crankshaft, Marine Diesel" was shipped a steam turbine rotor
 * (score 7) and then, on the retry, an engine block (score 7). Both are large,
 * centred, uncluttered, documentary-looking, real, imposing and fill the frame
 * -- every criterion passed, because none of them was identity. isSubject is a
 * hard structural field so passesGate() can enforce it in code rather than
 * hoping a composite score reflects it. Two wasted regen runs on one entry is
 * what the missing question cost; the same blind spot is why a desk globe sits
 * on "Globe, Library Floor Model".
 */
import { openaiChat, extractJson } from './openai-with-fallback.js';

const SYS_PROMPT = `You are a design reviewer for "Thiccctionary," a satirical daily dictionary of thiccc inanimate objects. Evaluate the chosen photo against these criteria:

0. IDENTITY TEST (Wave 321). THIS ONE OVERRIDES EVERY OTHER CRITERION. Is the photo OF THE NAMED OBJECT? Not of its neighbour, not of the assembly it belongs to, not of the room it lives in, not of a different member of the same family. Subjects are written in dictionary inversion, "Head Noun, Qualifier": in "Crankshaft, Marine Diesel" the object is a CRANKSHAFT and "Marine Diesel" only says which kind. The photo must show the head noun. An engine block is not a crankshaft. A turbine rotor is not a crankshaft. A desk globe is not a floor globe. A teapot is not a kettle. A cannonball is not a medicine ball. If you cannot positively identify the named object in the frame, set "isSubject": false and score 1, no matter how well composed, well lit, documentary, imposing or on-brand the photograph is. A beautiful photo of the wrong object is worse than no replacement at all, because it ships. When genuinely uncertain whether the object shown is the named one, answer false: a rejection costs one retry, a false accept puts a wrong plate in front of every reader.

1. SILHOUETTE COMPLETENESS, is the WHOLE subject visible? (rear-three-quarter, side-profile, full-frame views work; tight crops fail)
2. FRAMING, is the subject centered enough that a 4:3 or natural-aspect crop preserves it?
3. BRAND FIT, does the photo look like a documentary / dictionary plate, or a marketing render? (Documentary good, marketing bad)
4. CLUTTER, is the subject clearly the focal point, or surrounded by distractions?
5. PRIMARY-SUBJECT TEST, what is the photo OF? If the answer is a person (portrait, fashion, beauty, body close-up), DISQUALIFY, the brand never makes jokes about human bodies. If the answer is the actual subject thing (truck, tomato, instrument, building) and humans appear incidentally as bystanders / scale reference / crew / players holding the instrument, that's FINE. The rule is "no jokes about bodies," not "no humans visible." For musical instruments specifically: a photo of a tuba being PLAYED by someone is a photo of the tuba, and a marching brass band is a photo of the instruments. Reject only if the COMPOSITION centers a person's face or body.

6. REAL VS REPRESENTATION TEST, is this a photo of the ACTUAL subject, or a depiction of it? Things that count as DEPICTION and must be REJECTED (verdict "reject", score < 4): toys, sculptures, statues, figurines, costumes, replicas, fan art, illustrations, cartoons, action figures, model versions, 3D renders. Example: if the subject is "Transformer, Power Generation" (an electrical transformer) and the photo shows a Transformer-the-robot statue, REJECT. If the subject is "Pumpkin, Atlantic Giant" and the photo shows a person in a pumpkin costume, REJECT. If the subject is "Concrete Mixer" and the photo shows a toy concrete mixer, REJECT. Tells to watch for: visible seams, plastic surfaces, action-figure proportions, painted decals where real metal would be, weld marks at joints implying a built sculpture not a real machine, anything that reads as "made by an artist to look like X" rather than "is X."

7. GIRTH TEST (Wave 301, tuned 303). Every entry celebrates an object that is thiccc FOR ITS KIND: unusually large, heavily loaded, over-abundant, or imposing relative to a typical example. Judge girth relative to the subject's own category, not absolute size: a fully loaded banana split overflowing its boat IS thiccc; a single modest scoop is not. A photo of six standard cinnamon rolls in cupcake liners is NOT acceptable for 'Roll, Cinnamon Bun Oversized'. Disqualifying cues are ones that betray a modest, restrained, or subdivided example (cupcake liners, dainty portions, a small specimen of a normally large object). If the subject reads as a modest example of its kind, score ceiling is 4. Do NOT penalize a generously loaded or fully realized example merely because the object category is small.

8. SUBJECT-PROMINENCE TEST (Wave 200, Christopher 2026-05-23 'the latest post is more of a blacksmith than an anvil'; re-cut Wave 325). Do NOT estimate a percentage. Instead, draw a tight bounding box around the SUBJECT ITSELF and report it as "subjectBox": [x0, y0, x1, y1] in normalized 0-1 coordinates, origin top-left. Box the object, not the scene it sits in: for "Anvil" box the anvil, not the forge; for "Frigidaire" box the refrigerator, not the kitchen. Box the object, not what SUPPORTS OR HOLDS it either (Wave 328): exclude the stove, stand, table, bench, pedestal, plinth, cart, pallet, packaging, mount, bracket, and any hand or arm holding it. For "Kettle" box the kettle, not the kettle-and-stove column; for "Globe" box the globe, not the globe-and-its-wooden-stand; for a glass held in a hand, box the glass. If the entry's own search wording named the support ("kettle on a stove"), that is still not part of the subject. If the subject is partly out of frame, box only the visible part. The area is computed from your box downstream, so a loose box that swallows the room reads as a false prominence claim. Stranger test, which you must also answer: someone shown this photo with NO CAPTION, asked "what is this a picture of," gives one short answer. Report it verbatim as "strangerGuess". If the honest answer is 'a modern kitchen' and the entry is 'Frigidaire, Side-by-Side', say 'a modern kitchen'. Do not launder the guess toward the subject to help the photo pass.

9. SUBJECT-IDENTITY REALITY CHECK (Wave 226, post 5/31 'Industrial F350 kettle' incident). The subject string itself must be a REAL, plausibly-verifiable product designation, not a fabrication. RED FLAGS to auto-reject (verdict 'reject', score <= 3) regardless of how good the photo looks:
   - Model number borrowed from one product category and stuck onto another. Examples: "F350 kettle" (F350 = Ford truck), "Boeing 747 sofa", "M1 toaster", "Saturn V coffee pot". Vehicle/aircraft/military model numbers do not belong on kitchen, furniture, appliance, or animal subjects. If the subject combines a vehicle/aircraft/military model number with a non-vehicle category, REJECT.
   - Made-up product line that does not exist outside this entry. If the photo description contains a normal generic product (e.g. "stainless steel cooking pot") but the subject claims a specific manufacturer model that does not appear in the photo's metadata, treat as fabricated unless you personally recognize the model as real.
   - An obvious LLM-hallucination tell: random alphanumeric strings (KX-9000, ProMax-3500) on otherwise generic objects.
   If the subject fails this check, say so explicitly in the critique paragraph and set verdict='reject'.

Score 1 (unusable) to 10 (perfect). Brief one-paragraph critique. Output JSON only.`;

/**
 * Wave 325. subjectPercentEstimate used to be a number the model volunteered,
 * and criterion 8's "under 25% is an auto-reject" was a rule the same model was
 * asked to apply to its own number, in the same breath, before anything in code
 * saw either. passesGate() then re-read that number and called it verification.
 * It was not. It was one claim, read twice.
 *
 * The estimate ran generous every time it was checked against the picture. The
 * anvil that was really a blacksmith. The floor globe that was really a pair of
 * bookcases. And on 2026-07-25 a "Frigidaire, Side-by-Side" reshoot that came
 * back as an Unsplash photo captioned "modern kitchen with island and bar
 * stools" -- refrigerator at the left edge, part of it outside the crop, about
 * a ninth of the frame. Score 7, passed, shipped, replaced a better photograph.
 *
 * So stop asking for the arithmetic. Ask for a bounding box, which is
 * localisation rather than estimation and which vision models are much better
 * at, and compute the area here where the model cannot round it up. Same field
 * name on the way out, so all five consumers get the measured number without
 * being edited -- one writer, five readers, which is the shape this codebase
 * keeps having to relearn.
 *
 * A response with no usable box keeps whatever subjectPercentEstimate it came
 * with, so an older critic, or the Anthropic fallback on a bad day, degrades to
 * exactly the previous behaviour instead of to an exception.
 *
 * Wave 327 correction. "Degrades to the previous behaviour" was wrong, and the
 * 2026-07-25 Frigidaire proved it within a day. Wave 325 also removed
 * subjectPercentEstimate from the JSON the model is asked for, so when a box
 * comes back missing or malformed there is no longer any number to fall back
 * to -- the field is simply absent. passesGate() guarded its prominence check
 * with `typeof ... === 'number'`, which was a reasonable tolerance when the
 * field was always present and became a silent bypass the moment it was not.
 * Wave 325 did not loosen the prominence gate. For that case it removed it.
 * See passesGate() for the fix; this function is unchanged.
 */
export function withMeasuredProminence(c) {
  if (!c || typeof c !== 'object') return c;
  const b = c.subjectBox;
  if (!Array.isArray(b) || b.length !== 4 || b.some((n) => typeof n !== 'number' || !isFinite(n))) return c;
  // Tolerate either corner order and boxes that spill past the frame edge; a
  // subject cropped by the frame is common and is not a malformed answer.
  const x0 = Math.max(0, Math.min(b[0], b[2]));
  const x1 = Math.min(1, Math.max(b[0], b[2]));
  const y0 = Math.max(0, Math.min(b[1], b[3]));
  const y1 = Math.min(1, Math.max(b[1], b[3]));
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) return c;
  const measured = Math.round(w * h * 100);
  return {
    ...c,
    subjectPercentEstimate: measured,
    subjectPercentClaimed: c.subjectPercentEstimate,  // kept for the audit trail
    subjectPercentMeasured: measured,
  };
}

export async function critiqueImage({ subject, imageUrl, photoDescription, photographer }) {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  const userPrompt = `Subject: ${subject}
Photo description: ${photoDescription || '(no caption available)'}
${photographer ? `Photographer: ${photographer}\n` : ''}Photo URL: ${imageUrl}

Output JSON:
{
  "isSubject": <true if the photo positively shows the named object, false if it shows something else>,
  "score": <1-10>,
  "verdict": "ship" | "needs-review" | "reject",
  "subjectBox": [<x0>, <y0>, <x1>, <y1>],
  "strangerGuess": "what an uncaptioned viewer would say this photo is of, in a few words",
  "photoSubject": "one short clause describing what the photo ACTUALLY depicts, be specific. e.g. 'a real high-voltage electrical substation transformer' or 'a Transformer-the-robot sculpture made of car parts' or 'a 4-foot toy concrete mixer on a child's playmat'",
  "critique": "one paragraph explaining the score, what's good, what's weak. If isSubject is false, name what the photo shows instead. If the subject box is small, EXPLAIN what is dominating the frame."
}`;

  try {
    // openaiChat, not fetch: an OpenAI quota outage must not silently disable
    // the gate. It falls back to Anthropic and returns the same shape.
    const res = await openaiChat({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYS_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]}
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      console.warn(`[image-critic] chat returned ${res.status}, returning null`);
      return null;
    }
    const data = await res.json();
    // extractJson because the Anthropic fallback has no response_format and
    // will occasionally wrap its object in a fenced block.
    const c = JSON.parse(extractJson(data.choices[0].message.content));
    return withMeasuredProminence(c);
  } catch (e) {
    console.warn(`[image-critic] errored: ${e.message}`);
    return null;
  }
}

// Default gates used by callers. Tunable here so all consumers stay in sync.
export const GATES = {
  generate:  { minScore: 7, minSubjectPct: 25 },  // strict: net-new image
  regen:     { minScore: 7, minSubjectPct: 25 },  // strict: replacing a bad one
  throwback: { minScore: 6, minSubjectPct: 25 },  // looser: image already shipped
  // Wave 209b deliberately runs the daily looser than `generate`: the strict
  // gate was bailing on 5+ consecutive days. Score-5 ships with needsReview.
  daily:     { minScore: 5, minSubjectPct: 25 },
};

export function passesGate(critique, gate) {
  if (!critique) return true;  // critic unavailable, don't block
  // Wave 321: identity is not a matter of degree. A photo of the wrong object
  // fails outright, whatever it scored on composition. Checked with === false
  // so a critic response that predates this field behaves exactly as before.
  if (critique.isSubject === false) return false;
  if (typeof critique.score === 'number' && critique.score < gate.minScore) return false;
  // Wave 327: fail closed. This used to read `typeof x === 'number' && x < min`,
  // which passes anything that failed to produce a number at all. That tolerance
  // was harmless while the model was asked for the percentage directly and the
  // field was always present. Wave 325 replaced the percentage with a bounding
  // box, so a response that omits or malforms the box now arrives with no
  // prominence number whatsoever -- and the check waved it through. A gate that
  // disappears exactly when the critic answers badly is worse than no gate,
  // because the run log still says "passed".
  //
  // Rejecting instead is safe here in a way it would not be elsewhere: the
  // caller has two more attempts, and the outcome of exhausting them is "keep
  // the photograph that is already published", not "ship nothing".
  //
  // The one thing that must NOT start failing is an unreachable critic. `!critique`
  // above covers the null case, but generate-daily.js builds a sentinel object
  // on a critique timeout -- { score: null, verdict: 'unknown' } -- which is the
  // service being down wearing an object costume, and failing that closed would
  // block the daily post exactly the way Wave 209b's too-strict gate blocked
  // five days in a row. So the test is: a response carrying a real score is an
  // answer, and an answer with no prominence number is a failed measurement and
  // gets rejected. A response with no score either was never an answer at all.
  if (typeof gate.minSubjectPct === 'number') {
    const pct = critique.subjectPercentEstimate;
    if (typeof pct !== 'number') return typeof critique.score !== 'number';
    if (pct < gate.minSubjectPct) return false;
  }
  if (critique.verdict === 'reject') return false;
  return true;
}

/**
 * One line of evidence about a critique, for run logs.
 *
 * Wave 327. The reject path logged the score, the measured percentage, what the
 * critic saw and what a stranger would call it. The pass path logged the score
 * and what the critic saw. So audits/regen-last-run.md carried full evidence for
 * every photograph that did NOT ship and partial evidence for every photograph
 * that did, which is precisely backwards: the shipped ones are the ones anyone
 * would later need to audit. Both paths call this now, so they cannot drift
 * apart again.
 */
export function formatCritique(c) {
  if (!c) return 'no critique (critic unavailable)';
  const bits = [`score=${c.score}`];
  const pct = c.subjectPercentEstimate;
  bits.push(`subject%=${typeof pct === 'number' ? pct : 'UNMEASURED'}${
    typeof c.subjectPercentClaimed === 'number' ? ` measured (claimed ${c.subjectPercentClaimed})` : ''}`);
  if (c.isSubject === false) bits.push('NOT THE SUBJECT');
  bits.push(`saw "${c.photoSubject ?? 'n/a'}"`);
  bits.push(`stranger sees "${c.strangerGuess ?? 'n/a'}"`);
  return bits.join(', ');
}
