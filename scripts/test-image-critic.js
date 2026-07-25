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
import { withMeasuredProminence, passesGate, GATES, formatCritique, describeGate } from './image-critic.js';

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

// --- Wave 327: the hole Wave 325 opened and its own tests could not see. ---
//
// Every fixture above carries a subjectPercentEstimate, because that is what
// the model used to be asked for. Wave 325 stopped asking for it, so the
// realistic bad response is one with NO box and NO percentage -- and passesGate
// guarded the prominence check with `typeof === 'number'`, which waved that
// straight through. The suite tested the function that was rewritten and not
// the gate that read it.
const NO_NUMBERS = { isSubject: true, score: 8, verdict: 'ship',
  photoSubject: 'a stainless steel refrigerator in a kitchen' };

check('a critique with no prominence number is rejected, not waved through',
  passesGate(NO_NUMBERS, GATES.regen), false);
check('...and withMeasuredProminence cannot rescue it',
  passesGate(withMeasuredProminence(NO_NUMBERS), GATES.regen), false);
check('a malformed box is treated the same as no box',
  passesGate(withMeasuredProminence({ ...NO_NUMBERS, subjectBox: [0, 0, 1] }), GATES.regen), false);
check('a good box still passes',
  passesGate(withMeasuredProminence({ ...NO_NUMBERS, subjectBox: [0.1, 0.1, 0.9, 0.9] }), GATES.regen), true);
check('a missing critic still passes, because that is the service being down',
  passesGate(null, GATES.regen), true);
// generate-daily.js builds this exact object when critiqueChosenImage times out.
// Failing it closed would block the daily post, which is the Wave 209b failure.
check('the timeout sentinel is not an answer and must not block the daily',
  passesGate({ score: null, verdict: 'unknown', critique: 'Critique unavailable: critique timeout' }, GATES.daily), true);
check('a scored answer that failed to localise is an answer, and is rejected',
  passesGate({ score: 5, verdict: 'ship' }, GATES.daily), false);
check('a gate with no minSubjectPct does not require one',
  passesGate(NO_NUMBERS, { minScore: 7 }), true);

// --- formatCritique: one writer for the pass row and the reject row. ---
check('the unmeasured case is named, not printed as undefined',
  formatCritique(NO_NUMBERS).includes('subject%=UNMEASURED'), true);
check('the gap between measured and claimed is in the line',
  formatCritique(withMeasuredProminence(FRIGIDAIRE)),
  'score=7, subject%=9 measured (claimed 45), saw "n/a", stranger sees "n/a"');
check('identity failure is called out',
  formatCritique({ ...NO_NUMBERS, isSubject: false }).includes('NOT THE SUBJECT'), true);
check('a null critique formats rather than throws',
  formatCritique(null), 'no critique (critic unavailable)');

// --- Wave 328e: completeness, which the prominence number actively rewards. ---
//
// The 2026-07-06 Medicine Ball replacement is the fixture: a slam ball running
// off the top and right edges, measured at 40% BECAUSE it is cropped, scored
// exactly 7 against a gate of exactly 7. Prominence and completeness are
// different failures and only one of them was being measured.
const edges = (box) => withMeasuredProminence({ subjectBox: box })?.subjectEdgeTouches;

check('a box floating clear of every edge touches none', edges([0.2, 0.2, 0.8, 0.8]), 0);
check('one edge is a subject standing against the frame', edges([0.0, 0.2, 0.6, 0.8]), 1);
check('the Medicine Ball: off the top and off the right', edges([0.45, 0.0, 1.0, 0.85]), 2);
check('a box spilling past the frame counts the edges it spilled over',
  edges([-0.3, -0.2, 1.4, 0.9]), 3);
check('a subject filling the frame touches all four', edges([0, 0, 1, 1]), 4);
check('no box means no count, not a zero', edges(undefined), undefined);

const CROPPED = { isSubject: true, score: 8, verdict: 'ship', subjectBox: [0.45, 0.0, 1.0, 0.85] };
check('a cut-off subject is rejected by the regen gate however well it scores',
  passesGate(withMeasuredProminence(CROPPED), GATES.regen), false);
check('...and the same photo passes on prominence alone',
  withMeasuredProminence(CROPPED).subjectPercentEstimate >= GATES.regen.minSubjectPct, true);
check('one edge is still fine',
  passesGate(withMeasuredProminence({ ...CROPPED, subjectBox: [0.0, 0.15, 0.55, 0.85] }), GATES.regen), true);
// The gates that cannot afford to reject must not have picked this up. A daily
// with no fallback and a throwback that skips the social post outright are both
// the Wave 209b failure wearing a different label.
check('the daily gate does not enforce completeness', GATES.daily.maxEdgeTouches, undefined);
check('neither does throwback, because a failure there skips the post entirely',
  GATES.throwback.maxEdgeTouches, undefined);
check('a cut-off subject still ships on the daily', passesGate(withMeasuredProminence(CROPPED), GATES.daily), true);
check('the cut-off case is named in the log line',
  formatCritique(withMeasuredProminence(CROPPED)).includes('CUT OFF on 2 edges'), true);
check('a single edge is not worth saying',
  formatCritique(withMeasuredProminence({ ...CROPPED, subjectBox: [0.0, 0.15, 0.55, 0.85] })).includes('CUT OFF'), false);

// describeGate: the audit sentence is derived so it cannot fall behind GATES.
check('the regen gate describes every field it carries', describeGate(GATES.regen),
  'score >= 7 AND subject% >= 25 AND subject box touches <= 1 frame edge AND identity confirmed AND verdict not "reject"');
check('a gate without the new field does not mention it',
  describeGate(GATES.daily).includes('frame edge'), false);
check('a missing gate does not throw', describeGate(null), 'no gate');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed.');
process.exit(failed ? 1 : 0);
