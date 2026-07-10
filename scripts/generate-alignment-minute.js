/**
 * generate-alignment-minute.js - Wave 288.
 *
 * HR keeps trying to add to Jon's role; Jon refuses (CEO direction,
 * 2026-07-10). Monthly, the Director (sometimes at HR's urging) convenes
 * a role-scope alignment meeting proposing a NEW expansion of the
 * Circulation Manager's role. Jon produces the position description.
 * The minutes are inserted newest-first into
 * about/documents/role-scope-alignment/index.html and the intro
 * counters (#align-count, #align-minutes) are updated.
 *
 * Mirrors generate-grievance.js (Wave 221). Env: ANTHROPIC_API_KEY.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'about', 'documents', 'role-scope-alignment', 'index.html');

async function callClaude(systemPrompt, userPrompt) {
  const model = 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

const SYSTEM_PROMPT = `You write ONE new set of meeting minutes for the Role-Scope Alignment file at Thiccctionary.

THE SITUATION, PERMANENT: Human Resources and the Director of Editorial Operations keep trying to expand the Circulation Manager's role. The Circulation Manager refuses, every time, by producing his position description. The file grows. Alignment remains pending.

THE CHARACTERS:
- Jon, Circulation Manager since 2004. Around 50, thin distance-runner's build. Manages the circulation of a print edition that has not existed since before his hire. Keeps two racing burros, Registrar and Addendum, under Section 11 of his position description ("maintenance of delivery animals," unrevised since 1978). Attends every meeting holding a printed copy of the position description. Speaks at most ONE short sentence per meeting, usually none; his primary act is producing the document and indicating the relevant section. Never rude. Never explains twice. Meetings adjourn quickly.
- Constance Pribyl, Director of Editorial Operations. Keeps the minutes in a formal recording-secretary register, then appends a personal note in cheerful parking-lot HR-speak ("Hi all!", "parking-lot" as a verb, "alignment", "opportunity", "honors"). Genuinely fond of Jon. Never wins.
- Human Resources may be cited as the instigator of the proposal.

THE POSITION DESCRIPTION (cite ONLY these, exactly):
Section 1 Receipt of Returns; Section 2 Counting and Tally; Section 3 Assessment of Condition; Section 4 The Returns Ledger (4(c): the ledger records newsstand returns and nothing else, whatever else may occur); Section 5 Credit Reconciliation; Section 6 Storage of Returned Stock; Section 7 Safeguarding of Undistributed Stock in Transit; Section 8 Disposal; Section 9 Review (as warranted, warrant by agreement of both parties); Section 10 The Weekly Report (one line, weekly, accurate); Section 11 Maintenance of Delivery Animals (no ceiling on fitness is specified).

THE FORMAT (use EXACTLY this HTML structure):

<div class="grievance" id="alignment-{NUM}">
  <p class="grv-head">Role-Scope Alignment &middot; No. {NUM} &middot; Convened {DATE}</p>
  <div class="grv-body">
    <p>{THE MINUTES: 3-6 sentences, recording-secretary register. Meeting opened 10:00. A NEW specific proposal to expand the role. Jon produces the document and indicates a section (link it like: <a href="/about/documents/position-description-circulation/#section-4">Section 4</a>). The proposal fails on its own terms. Adjourned 10:0X (X between 2 and 8).}</p>
    <em class="signoff">Minutes kept by the Director</em>
  </div>
  <div class="grv-response">
    {CONSTANCE'S NOTE: "Hi all!" opener, 2-3 sentences of warm parking-lot spin on the failure. NO exclamation-point overuse; two maximum.}
    <em class="signoff">C.</em>
  </div>
  <p class="grv-status">Status: {PILL: 2-5 words, dry, e.g. "Alignment Pending", "Scope Needs Definition", "Revisiting in Q3"}</p>
</div>

CRITICAL RULES:
1. NO em dashes, NO en dashes. Commas, semicolons, periods, hyphens only.
2. The proposal must be FRESH (not in the recent list provided) and institutionally plausible: committee seats, platform ownership, mentorship, wellness initiatives, modernization pilots, coverage duties, czars of things.
3. Jon speaks at most one short sentence, and only if it lands.
4. Meetings open at 10:00 and adjourn between 10:02 and 10:08.
5. Once in a while the proposal fails because the document TECHNICALLY covers the opposite of what was asked; that is the best kind.
6. Output ONLY the HTML block. No preamble, no fences.`;

function formatDate(d) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function main() {
  const raw = await fs.readFile(FILE, 'utf8');
  const nums = [...raw.matchAll(/id="alignment-(\d+)"/g)].map(m => parseInt(m[1], 10));
  const nextNum = (nums.length ? Math.max(...nums) : 11) + 1;

  // recent proposals: first sentence after "10:00." of the newest 5 minutes
  const recent = [...raw.matchAll(/<div class="grv-body">\s*<p>Meeting opened 10:00\.([^.]*\.)/g)]
    .slice(0, 5).map(m => m[1].trim());

  const userPrompt = `Generate Role-Scope Alignment No. ${nextNum}, convened ${formatDate(new Date())}, with the id alignment-${String(nextNum)}.

Avoid re-proposing anything resembling these recent attempts:
${recent.map(h => '- ' + h).join('\n')}

Also already tried in older minutes: reimagining circulation for a digital-first landscape; newsletter ownership; a consultant's expanded position description; stretch goals; quarterly cadence. Pick something NEW. Output ONLY the HTML block.`;

  const html = (await callClaude(SYSTEM_PROMPT, userPrompt)).trim()
    .replace(/—/g, ', ').replace(/–/g, '-');
  if (!html.startsWith('<div class="grievance"') || !html.endsWith('</div>')) {
    console.error('LLM output failed format check; first 200 chars:', html.slice(0, 200));
    process.exit(1);
  }
  const adj = html.match(/Adjourned 10:(\d{2})/);
  const duration = adj ? Math.min(parseInt(adj[1], 10), 15) : 4;

  const marker = 'Alignment remains pending.</p>';
  if (!raw.includes(marker)) { console.error('intro marker missing'); process.exit(1); }
  let out = raw.replace(marker, marker + '\n\n' + html + '\n');

  // counters
  out = out.replace(/(<span id="align-count">)(\d+)(<\/span>)/, (_, a, n, b) => a + (parseInt(n, 10) + 1) + b);
  out = out.replace(/(<span id="align-minutes">)(\d+)(<\/span>)/, (_, a, n, b) => a + (parseInt(n, 10) + duration) + b);

  await fs.writeFile(FILE, out);
  console.log(`Alignment No. ${nextNum} filed (${duration} min).`);
}

main().catch(e => { console.error(e); process.exit(1); });
