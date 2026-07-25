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
import { queryLadder, gatherCandidates } from './lib/search-queries.js';

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

// --- Wave 328c: the ladder accumulates instead of stopping at the first hit. ---
//
// The Medicine Ball reshoot is the fixture. Firing one searched "leather
// medicine ball weighted" and got 29 candidates. Firing two led with "vintage
// leather medicine ball", got 6 unrelated leather objects, and stopped there --
// because 6 is not zero. The broad rung that had found 29 was never called.
async function gatherTests() {
  const photos = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
  const calls = [];
  const fake = (table) => async (q) => { calls.push(q); return table[q] || []; };

  {
    calls.length = 0;
    const r = await gatherCandidates(
      ['vintage leather medicine ball', 'leather medicine ball'],
      fake({ 'vintage leather medicine ball': photos('v', 6), 'leather medicine ball': photos('m', 29) }),
      { minPool: 15 });
    check('a thin first rung no longer ends the search', calls.length, 2);
    check('...and the pool is both rungs', r.candidates.length, 35);
    check('...with the thin rung still leading, because order is preference',
      r.candidates[0].id, 'v0');
    check('every rung that contributed is named for the audit row',
      r.queriesUsed, ['vintage leather medicine ball', 'leather medicine ball']);
  }

  {
    calls.length = 0;
    const r = await gatherCandidates(['a', 'b', 'c'],
      fake({ a: photos('a', 30), b: photos('b', 30), c: photos('c', 30) }), { minPool: 15 });
    check('a full first page still costs exactly one API call', calls.length, 1);
    check('...and does not drag the rest of the ladder in', r.candidates.length, 30);
  }

  {
    const r = await gatherCandidates(['a', 'b'],
      fake({ a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'y' }, { id: 'z' }] }), { minPool: 15 });
    check('the same photo found by two rungs appears once',
      r.candidates.map((c) => c.id), ['x', 'y', 'z']);
  }

  {
    calls.length = 0;
    const r = await gatherCandidates(['a', 'b'], fake({}), { minPool: 15 });
    check('an empty ladder result is still empty, and still walks every rung',
      [r.candidates.length, calls.length, r.queriesUsed.length], [0, 2, 0]);
  }

  {
    // A rung whose only hits are duplicates contributed nothing, so it must not
    // be credited -- an audit row naming it would send the next operator off
    // tuning a query that did no work.
    const r = await gatherCandidates(['a', 'b'],
      fake({ a: [{ id: 'x' }], b: [{ id: 'x' }] }), { minPool: 15 });
    check('a rung that added nothing is not credited', r.queriesUsed, ['a']);
  }

  {
    // This runs unattended at the far end of a workflow, so a search returning
    // a shape we did not anticipate must not throw.
    const r = await gatherCandidates(['a'], async () => undefined, { minPool: 15 });
    check('a search returning nothing at all does not throw', r.candidates.length, 0);
  }
}

await gatherTests();

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed.');
process.exit(failed ? 1 : 0);
