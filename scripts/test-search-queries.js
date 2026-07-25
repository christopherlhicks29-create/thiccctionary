/**
 * test-search-queries.js - Wave 326.
 *
 * queryLadder() decides whether a reshoot has any candidates at all. When it
 * returns one rung and that rung misses, the run ends with "no-results" and the
 * critic never sees a photograph -- which is exactly how the 2026-07-25
 * Frigidaire run burned an entire workflow execution. The cases worth pinning
 * are the ordering (operator's phrase first, headword rungs behind it) and the
 * guarantee that an override can no longer shorten the ladder.
 *
 * Run: node scripts/test-search-queries.js
 */
import { queryLadder } from './lib/search-queries.js';

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: got ${a}, expected ${e}`);
}

// --- Behaviour without an override is unchanged from Wave 314. ---
check('de-inverts then falls back to the head noun',
  queryLadder('Crankshaft, Marine Diesel'),
  ['Crankshaft, Marine Diesel', 'Marine Diesel Crankshaft', 'Crankshaft']);

check('a headword with no comma is a single rung', queryLadder('Anvil'), ['Anvil']);
check('the brand word is stripped', queryLadder('Thiccc Boeing'), ['Boeing']);
check('empty word yields an empty ladder', queryLadder(''), []);

// --- Wave 326: the override extends the ladder instead of replacing it. ---
check('override leads, headword rungs remain behind it',
  queryLadder('Frigidaire, Side-by-Side', 'stainless steel side by side refrigerator'),
  ['stainless steel side by side refrigerator', 'Frigidaire, Side-by-Side',
   'Side-by-Side Frigidaire', 'Frigidaire']);

check('an override never shortens the ladder',
  queryLadder('Frigidaire, Side-by-Side', 'stainless steel side by side refrigerator').length
    >= queryLadder('Frigidaire, Side-by-Side').length,
  true);

check('pipe-separated overrides become rungs in order',
  queryLadder('Kettledrum, Industrial', 'timpani orchestra|timpani|orchestral drum'),
  ['timpani orchestra', 'timpani', 'orchestral drum', 'Kettledrum, Industrial',
   'Industrial Kettledrum', 'Kettledrum']);

check('an override duplicating a headword rung does not repeat it',
  queryLadder('Anvil', 'Anvil'), ['Anvil']);

check('blank pipe segments are dropped',
  queryLadder('Anvil', 'blacksmith anvil||  |'), ['blacksmith anvil', 'Anvil']);

check('an override with no headword still works',
  queryLadder('', 'medicine ball gym weight'), ['medicine ball gym weight']);

check('whitespace-only override behaves as no override',
  queryLadder('Anvil, Blacksmith', '   '), ['Anvil, Blacksmith', 'Blacksmith Anvil', 'Anvil']);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed.');
process.exit(failed ? 1 : 0);
