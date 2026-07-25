/**
 * test-caption.js - Wave 329.
 *
 * writeCaption() runs unattended at the far end of a workflow, on a code path
 * that has already succeeded at the expensive part: the photograph is on disk
 * and entries.json is about to be written. Everything worth pinning here is a
 * degradation. What must a bad model response, a dead API, or a banned word do?
 * In every case the answer is the same shape -- fall to the next layer, and
 * never throw.
 *
 * Run: node scripts/test-caption.js
 */
import { captionFromSubject, writeCaption } from './lib/caption.js';
import { withPlateNumber } from './lib/plate.js';

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: got ${a}, expected ${e}`);
}

// A chat stub shaped like the Response that openaiChat returns.
const reply = (caption) => async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ caption }) } }] }),
});
const dead = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const throws = () => async () => { throw new Error('socket hang up'); };

// --- captionFromSubject: the layer everything else degrades to. ---
check('the critic clause becomes a plate line',
  captionFromSubject('a pair of copper timpani drums'),
  'Plate N., Pair of copper timpani drums.');
// "real" is the critic answering "is this a toy or a sculpture", not a word
// about the object, and it reads as a defensive tic under a photograph.
check('the real/toy hedge is not carried into the caption',
  captionFromSubject('a real pair of copper timpani drums'),
  'Plate N., Pair of copper timpani drums.');
check('...including the other hedges, without leaving "an cast iron kettle"',
  captionFromSubject('an actual cast iron kettle'), 'Plate N., Cast iron kettle.');
check('a trailing full stop is not doubled', captionFromSubject('a slam ball on gym flooring.'),
  'Plate N., Slam ball on gym flooring.');
check('a proper noun keeps its capital', captionFromSubject('the Ever Given at berth'),
  'Plate N., Ever Given at berth.');
check('a clause with no article is left alone', captionFromSubject('two timpani against a brick wall'),
  'Plate N., Two timpani against a brick wall.');
check('no description means no caption, not an empty one', captionFromSubject(''), null);
check('undefined is the same case', captionFromSubject(undefined), null);

// --- The plate number is plate.js's business, not this file's. ---
check('the caller numbers what this hands back',
  withPlateNumber(captionFromSubject('a pair of copper timpani drums'), 34),
  'Plate XXXIV., Pair of copper timpani drums.');

// --- writeCaption: the layering. ---
const timpani = { word: 'Kettledrum, Industrial', photoSubject: 'a real pair of copper timpani drums' };

check('a clean model caption is used as written',
  await writeCaption({ ...timpani, chat: reply('Plate N., A pair of timpani in majestic repose.') }),
  'Plate N., A pair of timpani in majestic repose.');

check('a dead API falls through to the critic description',
  await writeCaption({ ...timpani, chat: dead(429) }),
  'Plate N., Pair of copper timpani drums.');

check('a thrown request falls through the same way',
  await writeCaption({ ...timpani, chat: throws() }),
  'Plate N., Pair of copper timpani drums.');

check('an empty model caption is not an answer',
  await writeCaption({ ...timpani, chat: reply('   ') }),
  'Plate N., Pair of copper timpani drums.');

// The banned-words filter has never run against this field before, because
// nothing has ever written a caption here. It runs now, and it outranks voice.
check('a model caption in banned voice is refused and the flat one used',
  await writeCaption({ ...timpani, chat: reply('Plate N., The voluptuous curves of a timpani.') }),
  'Plate N., Pair of copper timpani drums.');

check('when both layers are unusable the answer is null, not a bad caption',
  await writeCaption({ word: 'X', photoSubject: 'hourglass curves', chat: reply('Plate N., Curvy.') }),
  null);

check('the Unsplash description is the last thing standing',
  await writeCaption({ word: 'X', photoSubject: '', photoDescription: 'a brass tuba on a stand', chat: dead(500) }),
  'Plate N., Brass tuba on a stand.');

check('nothing to describe at all returns null rather than throwing',
  await writeCaption({ word: 'X', chat: dead(500) }), null);

// The whole point: null must reach the caller as "keep what is there".
check('null is distinguishable from an empty caption',
  (await writeCaption({ word: 'X', chat: dead(500) })) === '', false);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed.');
process.exit(failed ? 1 : 0);
