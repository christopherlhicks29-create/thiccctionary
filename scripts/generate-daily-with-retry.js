#!/usr/bin/env node
/**
   * Wave 222: retry wrapper around generate-daily.js.
   *
   * Problem solved: for two weeks, daily.yml has been silent-skipping
   * because generate-daily.js bails when the queue-head subject fails the
   * critique gate (or has zero Unsplash results, or picker vetoes all
   * candidates). The bail is intentional, but it leaves the entire day
   * with no entry. Padding the queue doesn't help - the picker keeps
   * picking the same failing head subject every run.
   *
   * Fix: wrap generate-daily.js. On bail, the original script pops the
   * dead subject from the queue. The wrapper then re-invokes the script.
   * Repeats up to MAX_ATTEMPTS, advancing the queue each time, until
   * either an entry lands or we exhaust the budget.
   *
   * Detection of "entry actually wrote": checks whether an entry with
   * date === targetDate exists anywhere in entries.json.
   *
   * Wave 339 (2026-08-10): the detection above used to check
   * entries.json[0].date === targetDate instead. entries.json is sorted
   * newest-first, so index 0 is only ever targetDate when targetDate is
   * the live/current day. Every TARGET_DATE backfill of a PAST date was
   * therefore incapable of ever registering as landed, no matter how many
   * attempts actually succeeded - confirmed live 2026-08-10 backfilling
   * 2026-08-01: attempt 3 generated and saved "Pizza, Deep Dish"
   * (entries/2026-08-01.html written, entries.json spliced in-place,
   * confirmed by attempt 4 immediately seeing "Entry already exists"),
   * but the wrapper still logged attempt 3 as bailed and the whole run as
   * exhausted/failed, so no PR/commit step ever ran and the generated
   * entry was discarded when the runner exited. This is the real
   * explanation for every prior backfill "failure" (Waves 331/333-338).
   *
   * Env passthrough: SUBJECT_OVERRIDE / TARGET_DATE / FORCE_REGENERATE
   * all flow to each invocation.
   */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES = path.join(ROOT, 'data', 'entries.json');
const MAX_ATTEMPTS = 4;

function today() {
    return new Date().toISOString().slice(0, 10);
}

function latestEntryDate() {
    try {
          const e = JSON.parse(fs.readFileSync(ENTRIES, 'utf8'));
          return e[0]?.date || null;
    } catch { return null; }
}

// Wave 339: does entries.json contain ANY record for this date, regardless
// of its position in the (newest-first sorted) array. latestEntryDate()
// above only reflects the truly-most-recent entry, which is wrong for
// TARGET_DATE backfills of a past date - see header comment.
function entryExistsFor(date) {
    try {
          const e = JSON.parse(fs.readFileSync(ENTRIES, 'utf8'));
          return e.some(x => x.date === date);
    } catch { return false; }
}

// Wave 244e: the word currently catalogued for `date` (null if none). Used to
// detect whether a FORCE_REGENERATE actually REPLACED the entry vs. left the
// pre-existing one in place after a critique bail.
function entryWordFor(date) {
    try {
          const e = JSON.parse(fs.readFileSync(ENTRIES, 'utf8'));
          const hit = e.find(x => x.date === date);
          return hit ? hit.word : null;
    } catch { return null; }
}

function queueLength() {
    try {
          const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'subject-queue.json'), 'utf8'));
          return Array.isArray(q.queue) ? q.queue.length : 0;
    } catch { return 0; }
}

const targetDate = process.env.TARGET_DATE || today();
const haveOverride = !!process.env.SUBJECT_OVERRIDE;

console.log(`[retry-wrapper] target date: ${targetDate}`);
console.log(`[retry-wrapper] subject override: ${haveOverride ? process.env.SUBJECT_OVERRIDE : '(none, will use queue)'}`);
console.log(`[retry-wrapper] queue length: ${queueLength()}`);

// Wave 244d: honor FORCE_REGENERATE. Previously the wrapper short-circuited on
// "entry already exists" BEFORE ever calling generate-daily.js, so every forced
// regeneration (workflow_dispatch force_regenerate / .fire-daily-force) was a
// silent no-op -- the reason the duplicate 6/13 Chesterfield could not be
// replaced. When forcing, fall through; generate-daily.js does the actual
// splice+replace (and now avoids the subject it is replacing, Wave 244c).
const forceRegen = process.env.FORCE_REGENERATE === 'true';
// Snapshot the subject we're replacing so a forced regen knows it succeeded
// only when the catalogued word for this date actually CHANGES (a critique
// bail leaves the old entry on disk, which previously looked like success).
const originalWord = forceRegen ? entryWordFor(targetDate) : null;
function landed() {
    if (!entryExistsFor(targetDate)) return false;
    if (forceRegen && originalWord) return entryWordFor(targetDate) !== originalWord;
    return true;
}
if (entryExistsFor(targetDate) && !forceRegen) {
    console.log(`[retry-wrapper] entry for ${targetDate} already exists. Nothing to do.`);
    process.exit(0);
}
if (forceRegen) {
    console.log(`[retry-wrapper] FORCE_REGENERATE=true; regenerating ${targetDate} even though an entry exists.`);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n[retry-wrapper] ===== attempt ${attempt}/${MAX_ATTEMPTS} =====`);
    if (!haveOverride && queueLength() === 0 && attempt > 1) {
          console.log('[retry-wrapper] queue empty and no override - stopping retries.');
          break;
    }
    try {
          execSync('node generate-daily.js', {
                  cwd: __dirname,
                  stdio: 'inherit',
                  env: { ...process.env },
                  timeout: 5 * 60 * 1000,
          });
    } catch (e) {
          console.warn(`[retry-wrapper] attempt ${attempt} threw: ${e.message?.slice(0, 200) || 'unknown'}`);
          // Bail is exit 0 inside generate-daily.js, so a throw here means a
      // real error. Don't retry on real errors - propagate.
      process.exit(1);
    }
    // Did the entry actually land? (For a forced regen, "landed" means the
  // catalogued word changed - not merely that an entry exists for the date.)
  if (landed()) {
        console.log(`[retry-wrapper] entry for ${targetDate} landed on attempt ${attempt}.`);
        process.exit(0);
  }
    console.log(`[retry-wrapper] attempt ${attempt} bailed (no NEW entry for ${targetDate} yet). Queue now has ${queueLength()} item(s).`);
    // With an override, retrying with the same SUBJECT_OVERRIDE would
  // just bail the same way. Override callers (batch-entries, env) want
  // exactly one attempt.
  if (haveOverride) {
        console.log('[retry-wrapper] override mode - not retrying.');
        break;
  }
}

if (!landed()) {
    console.log(`[retry-wrapper] exhausted ${MAX_ATTEMPTS} attempts. No NEW entry landed for ${targetDate}.`);
    // Exit 0 (graceful) so the workflow's "Always commit trace" still runs
  // and the existing dead-subjects log captures the failures.
  process.exit(0);
}
