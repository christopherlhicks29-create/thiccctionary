#!/usr/bin/env node
/**
 * Wave 158: catalog burst tool.
 *
 * Reads data/.fire-batch-entries.json:
 *   { "subjects": ["Watermelon, Carolina Cross", "Anvil, Peter Wright", ...] }
 *
 * For each subject, spawns generate-daily.js with SUBJECT_OVERRIDE + a
 * TARGET_DATE going backwards from the oldest existing entry (so we
 * backfill the archive without colliding with the daily cron going
 * forward).
 *
 * Each subject runs through the full quality gate (image picker veto +
 * critique gate >= 6). Bailed subjects are logged but don't stop the
 * batch. Successful entries land in data/entries.json + entries/*.html.
 *
 * Required env (same as generate-daily.js):
 *   OPENAI_API_KEY
 *   UNSPLASH_ACCESS_KEY
 */

import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SENTINEL = path.join(ROOT, 'data', '.fire-batch-entries.json');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');

function daysAgo(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(SENTINEL, 'utf8'));
  } catch (e) {
    console.error(`[burst] cannot read sentinel: ${e.message}`);
    process.exit(1);
  }
  const subjects = (payload.subjects || []).map(s => String(s).trim()).filter(Boolean);
  if (subjects.length === 0) {
    console.error('[burst] no subjects in sentinel');
    process.exit(1);
  }
  if (subjects.length > 25) {
    console.error(`[burst] refusing batch of ${subjects.length} subjects (cap is 25)`);
    process.exit(1);
  }
  console.log(`[burst] processing ${subjects.length} subjects`);

  // Find oldest entry date so we can backfill backwards
  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  // entries are ordered newest-first; last is oldest
  const oldest = entries[entries.length - 1].date;
  console.log(`[burst] oldest entry is ${oldest}, will backfill from there`);

  // Wave 222: optional explicit dates array. If provided and length matches,
  // use those dates instead of backwards-from-oldest. Lets the admin backfill
  // specific MISSING dates between existing entries, not just append before.
  const explicitDates = Array.isArray(payload.dates) && payload.dates.length === subjects.length
    ? payload.dates
    : null;
  if (explicitDates) console.log(`[burst] using explicit dates: ${explicitDates.join(', ')}`);

  let succeeded = 0, failed = 0;
  for (let i = 0; i < subjects.length; i++) {
    const targetDate = explicitDates
      ? explicitDates[i]
      : daysAgo(oldest, i + 1);
    const subject = subjects[i];
    console.log(`\n[burst] [${i+1}/${subjects.length}] subject="${subject}" date=${targetDate}`);

    try {
      execSync('node generate-daily.js', {
        cwd: __dirname,
        stdio: 'inherit',
        env: {
          ...process.env,
          SUBJECT_OVERRIDE: subject,
          TARGET_DATE: targetDate,
        },
        timeout: 5 * 60 * 1000, // 5 min per subject ceiling
      });
      // Wave 231-fix: generate sibling .webp for the entry image (daily.yml does this automatically; burst was missing it)
      try {
        const imgPath = path.join(ROOT, 'images', `${targetDate}-${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`);
        execSync(`node ${path.join(__dirname, 'jpg-to-webp.js')} '${imgPath}'`, { cwd: ROOT, stdio: 'inherit' });
      } catch (webpErr) {
        console.warn(`[burst] webp generation failed (non-fatal): ${webpErr.message}`);
      }
      succeeded++;
      console.log(`[burst] OK ${subject} -> ${targetDate}`);
    } catch (e) {
      failed++;
      console.warn(`[burst] FAIL ${subject} (${e.message ? e.message.slice(0,120) : 'unknown'})`);
      // Don't break - keep trying the next subject
    }
  }

  // Clear sentinel - workflow will commit
  await fs.unlink(SENTINEL).catch(() => {});

  console.log(`\n[burst] done. ${succeeded} succeeded, ${failed} failed/bailed.`);
  if (succeeded === 0) {
    console.error('[burst] zero successes - workflow should not open a PR');
    process.exit(1);
  }
}

main().catch(e => { console.error('[burst] FATAL:', e); process.exit(1); });
