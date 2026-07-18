/**
 * Wave 204: shared image critic. Extracted from generate-daily.js so
 * regenerate-images.js and post-to-buffer.js (evening throwback) can use
 * the same subject-prominence gate.
 *
 * critiqueImage({ subject, imageUrl, photoDescription, photographer })
 *   -> { score, verdict, subjectPercentEstimate, photoSubject, critique }
 *
 * If OPENAI_API_KEY missing or call fails, returns null (caller decides
 * whether to ship or skip). Always non-blocking by design.
 */

const SYS_PROMPT = `You are a design reviewer for "Thiccctionary," a satirical daily dictionary of thiccc inanimate objects. Evaluate the chosen photo against these criteria:

1. SILHOUETTE COMPLETENESS, is the WHOLE subject visible?
2. FRAMING, is the subject centered enough that a natural crop preserves it?
3. BRAND FIT, does the photo look like a documentary plate, or a marketing render?
4. CLUTTER, is the subject clearly the focal point, or surrounded by distractions?
5. PRIMARY-SUBJECT TEST, what is the photo OF? If the answer is a person (portrait, fashion, beauty), DISQUALIFY.
6. REAL VS REPRESENTATION, reject toys, sculptures, statues, costumes, replicas, fan art, action figures.
7. GIRTH TEST (Wave 301). Every entry celebrates an object of UNUSUAL SIZE. Does the photo actually read as oversized, massive, or thiccc, or does it show a perfectly normal-sized example of the subject? A photo of six standard cinnamon rolls in cupcake liners is NOT acceptable for 'Roll, Cinnamon Bun Oversized', even though the subject matches. Look for scale cues (liners, hands, cutlery, standard plates) that betray ordinary size. If the object reads as normal-sized, score ceiling is 4.
8. SUBJECT-PROMINENCE TEST (Wave 200). Estimate the percent of frame area the SUBJECT itself occupies. If < 40%, score ceiling is 5. If < 25%, score ceiling is 3 (auto-reject). A 'blacksmith hammering an anvil' photo where the anvil is 20% of the frame is NOT an acceptable pick for an entry titled 'Anvil.' Stranger test: would someone seeing this with NO CAPTION identify the subject as the cataloged thing? If they'd guess 'blacksmith' or 'workshop' instead of 'anvil', score it down.

Score 1 (unusable) to 10 (perfect). Output JSON only.`;

export async function critiqueImage({ subject, imageUrl, photoDescription, photographer }) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  const userPrompt = `Subject: ${subject}
Photo description: ${photoDescription || '(no caption available)'}
${photographer ? `Photographer: ${photographer}\n` : ''}Photo URL: ${imageUrl}

Output JSON:
{
  "score": <1-10>,
  "verdict": "ship" | "needs-review" | "reject",
  "subjectPercentEstimate": <integer 0-100>,
  "photoSubject": "one short clause describing what the photo ACTUALLY depicts",
  "critique": "one paragraph"
}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
      console.warn(`[image-critic] OpenAI returned ${res.status}, returning null`);
      return null;
    }
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
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
};

export function passesGate(critique, gate) {
  if (!critique) return true;  // critic unavailable, don't block
  if (typeof critique.score === 'number' && critique.score < gate.minScore) return false;
  if (typeof critique.subjectPercentEstimate === 'number' && critique.subjectPercentEstimate < gate.minSubjectPct) return false;
  if (critique.verdict === 'reject') return false;
  return true;
}
