/**
 * test-image-critic.js - Wave 325.
 *
 * withMeasuredProminence() is the only place in the pipeline that turns a model
 * claim into a measured number, and everything downstream trusts its output, so
 * it gets a test rather than a spot check. The cases that matter are the
 * degradations: a response with no box, a malformed box, a zero-area box. Each
 * must return the object untouched, because the alternative to "behaves exactly
 * as it did before Wave 325" is "throws inside a nightly workflow at 4am".
 *
 * Run: node scripts/test-image-critic.js
 */
import { withMeasuredProminence, passesGate, GATES } from './image-critic.js';

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const pct = (o) => withMeasuredProminence(o)?.subjectPercentEstimate;

// The 2026-07-25 Frigidaire. The refrigerator runs down the left edge: about a
// seventh of the width, most of the height. The critic claimed 45 and scored 7.
const FRIGIDAIRE = { isSubject: true, score: 7, verdict: 'ship',
  subjectPercentEstimate: 45, subjectBox: [0.0, 0.12, 0.13, 0.82] };

check('measured area replaces the claim', pct(FRIGIDAIRE), 9);
check('healthy centred subject', pct({ subjectPercentEstimate: 70, subjectBox: [0.1, 0.1, 0.9, 0.9] }), 64);
check('corners in either order', pct({ subjectPercentEstimate: 70, subjectBox: [0.9, 0.9, 0.1, 0.1] }), 64);
check('box spilling past the frame clamps', pct({ subjectPercentEstimate: 90, subjectBox: [-0.2, -0.2, 1.2, 1.2] }), 100);

// Degradation: each of these must return the claimed number, not throw.
check('no box at all', pct({ subjectPercentEstimate: 55 }), 55);
check('box is a string', pct({ subjectPercentEstimate: 55, subjectBox: 'big' }), 55);
check('box has wrong arity', pct({ subjectPercentEstimate: 55, subjectBox: [0, 0, 1] }), 55);
check('box contains null', pct({ subjectPercentEstimate: 55, subjectBox: [0, null, 1, 1] }), 55);
check('box contains NaN', pct({ subjectPercentEstimate: 55, subjectBox: [0, NaN, 1, 1] }), 55);
check('zero-area box', pct({ subjectPercentEstimate: 55, subjectBox: [0.5, 0.5, 0.5, 0.5] }), 55);
check('null critique survives', withMeasuredProminence(null), null);

// The claim is kept, so a run log can show the size of the gap.
check('claim retained for the audit trail', withMeasuredProminence(FRIGIDAIRE).subjectPercentClaimed, 45);

// The point of all of the above.
check('the Frigidaire now fails the regen gate', passesGate(withMeasuredProminence(FRIGIDAIRE), GATES.regen), false);
check('the same photo passed on the claimed number', passesGate(FRIGIDAIRE, GATES.regen), true);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed.');
process.exit(failed ? 1 : 0);
