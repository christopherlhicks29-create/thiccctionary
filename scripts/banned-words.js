/**
 * Banned-words list and validator for Thiccctionary entry generation.
 *
 * Used by scripts/generate-daily.js and scripts/regenerate-text.js to
 * reject model outputs that violate the Wave 35 brand-voice rules.
 *
 * The wave-31 audit found that the model (even with explicit prompt
 * instructions) reverts to body-adjacent language and modern-internet
 * voice when generating definition #2 and example sentences. This
 * filter shifts enforcement from "the prompt asks the model not to"
 * to "the script rejects output if it does."
 */

// Words/phrases that reliably break the brand voice. Case-insensitive whole-word match.
// Categories:
//   - body language smuggled in as metaphor for objects
//   - modern-internet voice
//   - filler/AI-tells
export const BANNED_WORDS = [
  // Body-adjacent language (the editorial discipline depends on these NOT appearing)
  'voluptuous',
  'voluptuosity',
  'curves',           // when applied to objects, almost always body-coded
  'curvy',
  'runway',
  'fashion model',
  'fashion-model',
  'vintage model',
  'vintage-model',
  'hourglass',
  'hip-to-waist',
  'hip to waist',
  'well-endowed',
  'well endowed',
  'thin skins',
  'thin-skinned',
  'diva',
  'divas',
  'diva-like',

  // Modern-internet voice (breaks dictionary register)
  'like a boss',
  'OG of',
  'OG thiccc',
  'haters',
  'haterz',
  'slay',
  'queen energy',
  'main character',
  'lowkey',
  'highkey',
  'vibing',
  'vibes only',
  'no cap',
  'fr fr',
  'period.', // when used as internet-voice closer, not literal punctuation

  // Filler / AI-tells (Christopher specifically dislikes these)
  'stands as a testament',
  'serves as a testament',
  'a testament to',
  'monumentally',
  'undeniably',
  'genuinely thiccc',  // generic puffery
  'truly thiccc',      // same
  'absolute showstopper',
  'commands the room',
  'commands attention',
  'effortlessly enhancing',
  'elevating any',
  'statement piece',
  // Wave 60: more AI-tells observed in model output during session
  'in a class of its own',
  'stands tall',
  'stands out',
  'speaks volumes',
  'leaves no doubt',
  'an embodiment of',
  'to be reckoned with',
  'boasting',
  'boasts',
  'all eyes on',
  'showstopping',
];

// Regex patterns that catch broader violations than literal-string match.
export const BANNED_PATTERNS = [
  // "fresh off the X runway" pattern
  { regex: /fresh off the .*\brunway\b/i, why: 'runway-as-metaphor' },
  // "could launch a thousand X" — Helen of Troy reference applied to objects (corny)
  { regex: /could launch a thousand /i, why: 'launch-a-thousand cliche' },
  // "X commands the room/Y" — generic commanding-puff
  { regex: /commands the (room|space|spotlight)/i, why: 'commands-the-room cliche' },
  // "a [adjective] [adjective] of [noun]" stacked-adjective patterns
  // (commented out — too false-positive prone)
];

/**
 * Scan an entry's text fields for banned words and patterns.
 * Returns an array of { field, term, kind } violations.
 */
export function findBannedTerms(entry) {
  const violations = [];
  const fieldsToScan = ['definitions', 'example', 'etymology', 'caption', 'word'];

  for (const field of fieldsToScan) {
    const value = entry[field];
    const text = Array.isArray(value) ? value.join(' \n ') : (value || '');
    const lower = text.toLowerCase();

    for (const word of BANNED_WORDS) {
      // Case-insensitive whole-phrase check (handles multi-word phrases)
      const w = word.toLowerCase();
      // Use word-boundary for single words; substring for phrases with spaces
      let found = false;
      if (w.includes(' ') || w.includes('-')) {
        found = lower.includes(w);
      } else {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        found = re.test(text);
      }
      if (found) violations.push({ field, term: word, kind: 'banned-word' });
    }

    for (const { regex, why } of BANNED_PATTERNS) {
      if (regex.test(text)) violations.push({ field, term: regex.source, kind: 'banned-pattern', why });
    }
  }
  return violations;
}

/**
 * True if entry passes all checks; false if any banned terms are found.
 * Logs violations for visibility.
 */
export function validateEntry(entry) {
  const violations = findBannedTerms(entry);
  if (violations.length === 0) return { ok: true, violations: [] };

  console.warn(`  ⚠️ Banned terms found in entry "${entry.word}":`);
  for (const v of violations) {
    console.warn(`     [${v.field}] "${v.term}" (${v.kind}${v.why ? ': ' + v.why : ''})`);
  }
  return { ok: false, violations };
}
