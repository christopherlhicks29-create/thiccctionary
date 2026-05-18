/**
 * Bi-weekly running-bit injector.
 *
 * Asks Claude to invent one small office-life development for a randomly chosen
 * staff member, then appends it to data/office-events.json#running_bits.
 * Keeps the corpus growing without manual input. Bits are short (1-2 sentences),
 * specific, and reusable in future posts/articles.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAFF_PATH = path.join(ROOT, 'data', 'editorial-staff.json');
const EVENTS_PATH = path.join(ROOT, 'data', 'office-events.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY missing'); process.exit(1); }

async function callClaude(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system, messages: [{ role: 'user', content: user }], temperature: 0.9 }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function main() {
  const staff = JSON.parse(await fs.readFile(STAFF_PATH, 'utf8'));
  const events = JSON.parse(await fs.readFile(EVENTS_PATH, 'utf8'));

  // Pick a random staff member (uniform, every character deserves bit growth)
  const member = staff.staff[Math.floor(Math.random() * staff.staff.length)];

  // Pull this character's existing bits so Claude knows what NOT to repeat
  const existingForMember = (events.running_bits || []).filter(b => b.characters && b.characters.includes(member.id));
  const existingSummaries = existingForMember.map(b => `- ${b.summary}`).join('\n') || 'none';

  const system = `You are inventing a new running bit for the Thiccctionary editorial staff. Tone: The Office × 1962 magazine editor. Dry, specific, deadpan. The bit should be reusable in future social posts and articles.

HARD RULES:
- 1-2 sentences. Total length ≤ 280 chars.
- Specific. Names, numbers, places. No vague generic stuff.
- Funny but not jokey. The humor is in the specificity.
- Must FIT the character's existing voice and obsessions.
- Must NOT contradict existing bits.
- No em-dashes (—). Use commas, periods, colons, parens.
- Return ONLY the bit text. No preamble, no quote marks, no JSON.`;

  const user = `Character: ${member.name} (${member.title})

Voice: ${member.voice}

Obsessions: ${(member.obsessions || []).join(', ')}

Existing running bits for this character (do not repeat any of these):
${existingSummaries}

Invent ONE new running bit. Something small that happened or is happening to them at the office. Return just the text.`;

  const bit = await callClaude(system, user);
  if (!bit || bit.length < 20) {
    console.error('Claude returned an empty or tiny bit; aborting');
    process.exit(1);
  }
  if (bit.includes(', ')) {
    console.error('Claude included an em-dash despite the ban; aborting');
    process.exit(1);
  }

  const newBit = {
    id: `auto-bit-${Date.now()}`,
    characters: [member.id],
    summary: bit,
    added_at: new Date().toISOString().slice(0, 10),
  };
  events.running_bits = events.running_bits || [];
  events.running_bits.push(newBit);
  await fs.writeFile(EVENTS_PATH, JSON.stringify(events, null, 2) + '\n', 'utf8');

  console.log(`\n[bit-injector] new bit for ${member.id}:`);
  console.log(`  ${bit}`);
  console.log(`\n[bit-injector] total running bits: ${events.running_bits.length}`);
}

main().catch(err => { console.error('[bit-injector] FATAL:', err); process.exit(1); });
