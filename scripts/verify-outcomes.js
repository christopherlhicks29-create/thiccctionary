#!/usr/bin/env node
/**
 * Wave 205: outcome verifier. Checks expected artifacts landed for each
 * scheduled workflow. Solves the "exit 0 but no artifact" silent-failure
 * pattern by treating missing artifacts as failures even when the producer
 * workflow reported success.
 *
 * Run: node scripts/verify-outcomes.js [--workflow=daily]
 *
 * Exits 1 if any expected outcome is missing. Writes audit log to
 * audits/outcome-checks/<stamp>.md regardless.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

// ----- Expected outcomes -----
// Each check returns { name, status: 'pass'|'fail', detail }.

function check_daily_entry_landed() {
  const entriesPath = path.join(ROOT, 'data', 'entries.json');
  const htmlPath = path.join(ROOT, 'entries', `${today}.html`);
  let detail = [];
  let pass = true;

  // entries.json must contain a record for today
  try {
    const entries = JSON.parse(fs.readFileSync(entriesPath, 'utf8'));
    const todays = entries.find(e => e.date === today);
    if (!todays) {
      pass = false;
      detail.push(`entries.json has no record for ${today} (latest: ${entries[0]?.date} ${entries[0]?.word})`);
    } else {
      detail.push(`entries.json record present: "${todays.word}"`);
    }
  } catch (e) {
    pass = false;
    detail.push(`could not read entries.json: ${e.message}`);
  }

  // entries/<today>.html must exist
  if (!fs.existsSync(htmlPath)) {
    pass = false;
    detail.push(`entries/${today}.html missing on disk`);
  } else {
    const sz = fs.statSync(htmlPath).size;
    if (sz < 1024) {
      pass = false;
      detail.push(`entries/${today}.html exists but is only ${sz}B (suspicious)`);
    } else {
      detail.push(`entries/${today}.html present (${sz}B)`);
    }
  }

  // Image must exist (slug-resolved)
  let imgFound = false;
  try {
    const files = fs.readdirSync(path.join(ROOT, 'images'));
    imgFound = files.some(f => f.startsWith(today));
    if (!imgFound) {
      pass = false;
      detail.push(`no images/${today}*.jpg found`);
    } else {
      detail.push(`image present for ${today}`);
    }
  } catch (e) {
    detail.push(`could not list images/: ${e.message}`);
  }

  return { name: 'daily-entry-landed', status: pass ? 'pass' : 'fail', detail: detail.join('; ') };
}

function check_reel_video_landed() {
  // Reels build a video the day AFTER the entry. So we expect a video for
  // YESTERDAY's date (if cadence is alive). If today is Monday and yesterday
  // is Sunday, expect videos/<yesterday>.mp4 to exist.
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const videoPath = path.join(ROOT, 'videos', `${yesterday}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return { name: 'reel-video-yesterday', status: 'fail', detail: `videos/${yesterday}.mp4 missing` };
  }
  const sz = fs.statSync(videoPath).size;
  if (sz < 100_000) {
    return { name: 'reel-video-yesterday', status: 'fail', detail: `videos/${yesterday}.mp4 only ${sz}B (suspicious)` };
  }
  return { name: 'reel-video-yesterday', status: 'pass', detail: `${sz} bytes` };
}

// ----- Runner -----
const CHECKS = {
  daily: [check_daily_entry_landed],
  reel: [check_reel_video_landed],
  all: [check_daily_entry_landed, check_reel_video_landed],
};

const arg = process.argv.find(a => a.startsWith('--workflow=')) || '--workflow=all';
const which = arg.split('=')[1];
const fns = CHECKS[which] || CHECKS.all;

console.log(`[verify-outcomes] running ${fns.length} check(s) for workflow="${which}"`);
const results = fns.map(fn => fn());
const failed = results.filter(r => r.status === 'fail');

// Write audit log
const audDir = path.join(ROOT, 'audits', 'outcome-checks');
fs.mkdirSync(audDir, { recursive: true });
const auditLines = [
  `# Outcome verification, ${stamp}`,
  ``,
  `Workflow scope: \`${which}\``,
  `Today: \`${today}\``,
  ``,
  `## Results`,
  ``,
  ...results.map(r => `- **${r.status === 'pass' ? 'PASS' : 'FAIL'}** [${r.name}]: ${r.detail}`),
  ``,
];
if (failed.length > 0) {
  auditLines.push(`## Verdict: ${failed.length} outcome(s) missing.`);
  auditLines.push(``);
  auditLines.push(`The producing workflow may have reported success but did not actually land the expected artifact. The outcome-verify workflow will fire the appropriate sentinel to retry.`);
}
fs.writeFileSync(path.join(audDir, `${stamp}.md`), auditLines.join('\n'));
console.log(`[verify-outcomes] wrote audits/outcome-checks/${stamp}.md`);

for (const r of results) {
  console.log(`  ${r.status === 'pass' ? 'PASS' : 'FAIL'} [${r.name}]: ${r.detail}`);
}

if (failed.length > 0) {
  console.log(`\n[verify-outcomes] FAIL: ${failed.length} missing outcome(s).`);
  process.exit(1);
}
console.log('[verify-outcomes] all expected outcomes present.');
process.exit(0);
