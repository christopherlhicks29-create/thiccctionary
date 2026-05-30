#!/usr/bin/env node
/**
 * Wave 221: Weekly auto-grievance.
 *
 * Bart files a new grievance with HR; Constance responds in parking-lot
 * HR-speak. Inserts the new entry at the top of /about/documents/personnel-file/
 * (newest first) and reuses the established grievance HTML/CSS structure.
 *
 * Cadence: Tuesdays 14:00 UTC, via grievance.yml.
 * Manual fire: data/.fire-grievance sentinel or workflow_dispatch.
 *
 * Output: edits about/documents/personnel-file/index.html in place.
 *
 * Env required: ANTHROPIC_API_KEY.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'about/documents/personnel-file/index.html');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

async function callClaude(systemPrompt, userPrompt, model = 'claude-sonnet-4-6') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

const SYSTEM_PROMPT = `You generate a SINGLE new grievance for The Personnel File at Thiccctionary.

THE CHARACTERS:
- Bartholomew "Bart" Whitmore: Senior Cataloguer at Thiccctionary since 2007. Dry to the point of mineral. Files grievances at the Director of Editorial Operations in third-person register ("The undersigned has observed..."). Treats modern workplace conventions as anthropological curiosities to be objected to in writing. Believes the publication should have stopped accepting submissions in 2014. Wrote the Style Guide. Files grievances with a fountain pen on Mondays. Always signs "The Senior Cataloguer", never his name.
- Constance Pribyl: Director of Editorial Operations since 2003. Hired by Bertram, by post, to modernize editorial operations. Has not. Maintains a cheerful, structurally-polite demeanor. Refers to grievances as "concerns", refusals as "parking lot items", disputes as "opportunities to align." Always opens replies with "Hi Bart!" and closes with "Let me know if you need anything else!" Uses "we" for things only Bart did. Uses "parking lot" as a verb. References planning artifacts ("I will add this to our Q3 review"). Signs simply "C." in 2024+ (we are well past her formal-title era).

THE FORMAT (use EXACTLY this HTML structure):

<div class="grievance">
  <p class="grv-head">Grievance &middot; <span class="grv-num">No. {NUM}</span> &middot; Filed {DATE}</p>
  <div class="grv-body">
    <strong>Re: {SHORT TITLE}.</strong>
    <p>{BART'S GRIEVANCE BODY - 2 to 4 sentences, third-person register, dry, specific. NO em dashes. Use commas, semicolons, periods, hyphens only.}</p>
    <em class="signoff">The Senior Cataloguer</em>
  </div>
  <div class="grv-response">
    {CONSTANCE'S RESPONSE - "Hi Bart!" opener, 2 to 4 sentences, parking-lot HR-speak, closes with "Let me know if you need anything else!" NO em dashes.}
    <em class="signoff">C.</em>
  </div>
  <p class="grv-status">Status: {STATUS PILL - 2 to 5 words, sardonic, e.g. "Acknowledged", "Tabled", "Will Discuss at Our Next 1:1", "Routed to Facilities", "Added to Parking Lot"}</p>
</div>

CRITICAL RULES:
1. NO em dashes anywhere. Use commas, semicolons, periods, or hyphens (-).
2. NO en dashes either.
3. Bart's body is third-person ("The undersigned has observed..."), never first-person.
4. Constance ALWAYS opens with "Hi Bart!" and closes with "Let me know if you need anything else!"
5. Both sections end with the exact <em class="signoff">...</em> tags shown above.
6. The grievance must concern a workplace minutia: office equipment, communication platforms, scheduling artifacts, team-building, modern HR conventions, sustainability initiatives, building amenities, calendar systems, software the publication has been forced to adopt, etc. NOT thiccc-taxonomy disputes (those go in the Style Guide).
7. The joke is the gap between Bart's third-person formal objection and Constance's cheerful corporate non-response. The status pill seals it.

OUTPUT: Return ONLY the HTML for the new grievance. No preamble, no explanation, no markdown fences. Start with <div class="grievance"> and end with </div>.`;

function formatDate(d) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function main() {
  console.log('Generating new grievance for the Personnel File...');
  const today = new Date();
  const dateStr = formatDate(today);

  const raw = await fs.readFile(FILE, 'utf8');
  const nums = [...raw.matchAll(/class="grv-num">No\. (\d+)</g)].map(m => parseInt(m[1], 10));
  const nextNum = (nums.length ? Math.max(...nums) : 49) + 1;

  const recent = [...raw.matchAll(/<strong>(Re: [^<]+)<\/strong>/g)].slice(0, 5).map(m => m[1]);

  const userPrompt = `Generate Grievance No. ${nextNum}, filed ${dateStr}.

Avoid repeating these recent grievance headlines:
${recent.map(h => '- ' + h).join('\n')}

Pick a fresh workplace minutia. Optional topic seeds (use at most loosely; pick something fresh if a better idea presents):
- The motion-sensor light in the editorial office turning off when Bart is reading
- The Q3 review of the coffee machine being re-deferred to Q1 next year
- A sustainability initiative requiring the disposal of the brass paperweight
- The Slack workspace adding a "watercooler" channel
- A 1:1 cadence change announced by Slack notification
- A new submission portal that requires logging in via Google
- An anniversary-of-tenure email Bart received marked "We are so glad you are here!"
- The all-hands meeting being moved to a video platform

Use ONE of these or invent a better fresh one. NO em dashes. Output ONLY the <div class="grievance">...</div> HTML.`;

  const html = await callClaude(SYSTEM_PROMPT, userPrompt);
  const clean = html.trim().replace(/—/g, ', ').replace(/–/g, '-');
  if (!clean.startsWith('<div class="grievance">') || !clean.endsWith('</div>')) {
    console.error('LLM output failed format check; first 200 chars:', clean.slice(0, 200));
    process.exit(1);
  }
  console.log(`Generated Grievance No. ${nextNum}.`);

  const marker = '<p style="font-family: var(--font-body); font-size: 16px; line-height: 1.7; color: var(--ink);">The Senior Cataloguer files grievances. The Director of Editorial Operations responds. The following is a selected log, maintained for editorial transparency. Earlier grievances are filed in the green cabinet, third drawer.</p>';
  if (!raw.includes(marker)) {
    console.error('Could not find intro marker in personnel-file/index.html');
    process.exit(1);
  }
  const out = raw.replace(marker, marker + '\n\n' + clean + '\n');
  await fs.writeFile(FILE, out);
  console.log(`Inserted Grievance No. ${nextNum} into ${FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
