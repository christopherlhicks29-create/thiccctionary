#!/usr/bin/env node
/**
 * Wave 160: simulated 6-month office relationship history.
 *
 * Generates data/office-history.json - a structured bible the social-post
 * generators can query for continuity. Three layers:
 *   - relationships: one-line dynamic per staff pair
 *   - events: ~25 dated incidents Nov 2025 -> May 2026
 *   - active_tensions: 3-6 unresolved threads current posts can pull from
 *
 * Constraints (set by Christopher 2026-05-17):
 *   - Anchor: Eli vs Bart (institutional gravity vs restless ambition)
 *   - Tone: cozy-mean (The Office floor, not Succession ceiling)
 *   - Internal use only - readers infer dynamics from posts over time
 *
 * Required env:
 *   ANTHROPIC_API_KEY  Claude is better at this kind of fiction
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAFF_PATH = path.join(ROOT, 'data', 'editorial-staff.json');
const EVENTS_PATH = path.join(ROOT, 'data', 'office-events.json');
const OUT_PATH = path.join(ROOT, 'data', 'office-history.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY required'); process.exit(1); }

async function callClaude(system, userMessage, maxTokens = 4000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

function extractJson(text) {
  // Claude may wrap output in ```json ... ``` or just return raw JSON.
  const fenced = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (fenced) return JSON.parse(fenced[1]);
  return JSON.parse(text);
}

async function main() {
  const staffData = JSON.parse(await fs.readFile(STAFF_PATH, 'utf8'));
  const events = JSON.parse(await fs.readFile(EVENTS_PATH, 'utf8'));

  const staffSummary = staffData.staff.map(s => `  - ${s.id} ("${s.name}", ${s.title}): ${s.voice.split('.').slice(0, 2).join('.')}.`).join('\n');
  const existingBits = (events.running_bits || []).map(b => `  - ${b.id} (${b.characters.join(', ')}): ${b.summary}`).join('\n');

  const system = `You are the Thiccctionary's writers' room. You're building a private show bible for an absurdist deadpan catalog of large objects.

The voice is cozy-mean (The Office, not Succession). Real friction, snarky emails, but nobody quits or breaks down. Affectionate at the floor. Specific over generic. The humor lives in the friction between Bart's institutional gravity and Eli's restless ambition.

You output strictly valid JSON. No prose, no markdown commentary, just the JSON object.

CRITICAL: every event you write must EARN its slot. "Bart sent a passive-aggressive email about the printer" is generic and does not earn a slot. "Bart filed objection #47 over a single en-dash in Eli's piece on the bollard" earns its slot because it's specific, telegraphs a dynamic, and could be quoted as a running bit in a social post six months later.`;

  const userPrompt = `Build the Thiccctionary office relationship bible. Period: November 1, 2025 through May 17, 2026 (today).

CHARACTERS (their voice + frequency is already established - do not reinvent):
${staffSummary}

ANCHOR RELATIONSHIP: Eli (eli) vs Bart (bart). Eli is restless, sardonic, ambitious. Bart is the Senior Cataloguer of Records, immovable, treats every catalogue addition as a constitutional matter. Eli writes; Bart objects. Bart files written objections via interoffice memo (paper, never email). Eli's responses are slightly mocking but never cruel. They have lunch together every Tuesday and neither would admit they look forward to it.

SECONDARY DYNAMICS to develop:
- Teddy (junior cataloguer) is in Bart's department but reads Eli as a mentor. Bart finds this disloyal. Teddy doesn't notice.
- Margie (Editor-in-Chief) is rarely in office. Posts from yachts, vineyards, Monaco. Eli admires her freedom; Bart suspects she's not actually working.
- Spider (untraceable correspondent) - no one has met them. Files copy from Sheffield, Macau, ferries. Treat as a running mystery, not a character.
- Hugh (deadpan Reels narrator) - mostly works from his car. Has met everyone once. Has opinions but rarely shares them.

EXISTING RUNNING BITS that are already canon (preserve, build on, don't contradict):
${existingBits}

Output a JSON object with this exact structure:

{
  "version": 1,
  "generated_at": "ISO8601",
  "tone": "cozy-mean",
  "anchor_pair": "eli-bart",
  "relationships": [
    { "pair": ["eli", "bart"], "one_line": "Restless writer vs immovable cataloguer. Tuesday lunches neither admits they need.", "current_state": "Bart's objections to Eli's last 3 pieces remain unresolved." },
    ... (one entry per meaningful pair: eli-bart, eli-teddy, bart-teddy, eli-margie, bart-margie, teddy-margie, eli-hugh, bart-spider, teddy-spider, etc. - skip pairs that have no real dynamic)
  ],
  "events": [
    {
      "date": "2025-11-12",
      "participants": ["eli", "bart"],
      "summary": "ONE SENTENCE describing a specific incident.",
      "what_it_revealed": "ONE SENTENCE on the dynamic shift or character note.",
      "tags": ["objection", "tuesday-lunch", etc.]
    },
    ... (target 25 events, distributed across the 6 months, weighted toward the Eli-Bart spine but with at least 6 events involving someone besides those two)
  ],
  "active_tensions": [
    { "id": "kebab-case-id", "summary": "ONE SENTENCE", "since": "YYYY-MM-DD", "involves": ["eli", "bart"] },
    ... (3-6 unresolved threads current posts can reference)
  ]
}

REQUIREMENTS:
- Events spread across all 6 months (not clumped)
- At least 3 events that build on the existing running bits (saturn-v-feud, margie-monaco, spider-untraceable, bart-objections)
- Specific objects (a bollard outside the building, a specific brand of chai Spider mentioned, the photo of a fire hydrant Eli took on a walk)
- Earned moments only - no generic office trope ("birthday party," "team building") unless tied to the catalogue's voice
- Cozy-mean: Bart can be petty; he can't be cruel. Eli can mock; she can't be vicious. Affectionate at the floor.
- Reader-legibility: someone reading a post that mentions "the bollard incident" should be able to infer roughly what happened from one or two sentences

Return ONLY the JSON object. No preamble, no postamble.`;

  console.log('[bible] calling Claude (this takes ~30s)...');
  const text = await callClaude(system, userPrompt, 4000);
  console.log(`[bible] got ${text.length} chars`);

  let bible;
  try {
    bible = extractJson(text);
  } catch (e) {
    console.error('[bible] JSON parse failed:', e.message);
    console.error('[bible] raw output (first 1000 chars):', text.slice(0, 1000));
    process.exit(1);
  }

  // Sanity checks
  const errors = [];
  if (!Array.isArray(bible.relationships) || bible.relationships.length < 5) errors.push(`expected >= 5 relationships, got ${bible.relationships?.length}`);
  if (!Array.isArray(bible.events) || bible.events.length < 18) errors.push(`expected >= 18 events, got ${bible.events?.length}`);
  if (!Array.isArray(bible.active_tensions) || bible.active_tensions.length < 3) errors.push(`expected >= 3 active_tensions, got ${bible.active_tensions?.length}`);
  bible.generated_at = bible.generated_at || new Date().toISOString();

  if (errors.length > 0) {
    console.warn('[bible] validation warnings (will write anyway):');
    errors.forEach(e => console.warn('  - ' + e));
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(bible, null, 2) + '\n', 'utf8');
  console.log(`[bible] wrote ${OUT_PATH}`);
  console.log(`[bible]   relationships: ${bible.relationships.length}`);
  console.log(`[bible]   events: ${bible.events.length}`);
  console.log(`[bible]   active_tensions: ${bible.active_tensions.length}`);

  // Print a few samples to stdout so the workflow log shows quality
  console.log('\n=== SAMPLE RELATIONSHIPS ===');
  bible.relationships.slice(0, 3).forEach(r => console.log(`  ${r.pair.join(' <-> ')}: ${r.one_line}`));
  console.log('\n=== SAMPLE EVENTS ===');
  bible.events.slice(0, 4).forEach(e => console.log(`  ${e.date} (${e.participants.join('+')}): ${e.summary}`));
  console.log('\n=== ACTIVE TENSIONS ===');
  bible.active_tensions.forEach(t => console.log(`  [${t.id}] ${t.summary}`));
}

main().catch(e => { console.error('[bible] FATAL:', e); process.exit(1); });
