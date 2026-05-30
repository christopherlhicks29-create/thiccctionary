#!/usr/bin/env node
/**
 * Wave 212: catalog-wide image audit.
 *
 * Walks every entry in data/entries.json, fetches the live image URL,
 * and runs Wave 204's image critic against the entry word as the
 * subject. Outputs:
 *   - audits/image-audit/YYYY-MM-DD.md (human-readable report)
 *   - data/image-audit-results.json (machine-readable, admin reads this)
 *
 * Flags any image where score < 6 OR subjectPercentEstimate < 25
 * (matching Wave 204's throwback gate). Writes the worst N (default 5)
 * into data/regen-queue.json so the regen-on-push workflow fires them
 * in sequence.
 *
 * Env required: OPENAI_API_KEY.
 * Optional: AUDIT_LIMIT=N (default unlimited), AUTO_QUEUE_TOP=N (default 5,
 *           set to 0 to skip auto-queueing).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { critiqueImage, passesGate, GATES } from './image-critic.js';

const ROOT = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const BASE_URL = 'https://thiccctionary.com';
const AUDIT_LIMIT = parseInt(process.env.AUDIT_LIMIT || '0', 10) || Infinity;
const AUTO_QUEUE_TOP = parseInt(process.env.AUTO_QUEUE_TOP || '5', 10);

if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY required');
  process.exit(1);
}

async function main() {
  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  console.log(`[image-audit] auditing ${Math.min(entries.length, AUDIT_LIMIT)} of ${entries.length} entries`);

  const results = [];
  let i = 0;
  for (const e of entries.slice(0, AUDIT_LIMIT)) {
    i++;
    const imageUrl = /^https?:/.test(e.image || '') ? e.image : `${BASE_URL}/${e.image}`;
    console.log(`[${i}/${Math.min(entries.length, AUDIT_LIMIT)}] ${e.date} ${e.word}`);
    let c = null;
    try {
      c = await critiqueImage({
        subject: e.word,
        imageUrl,
        photoDescription: e.caption || null,
        photographer: e.photographer || null,
      });
    } catch (err) {
      console.warn(`  critic errored: ${err.message}`);
    }
    const passed = passesGate(c, GATES.throwback);
    results.push({
      date: e.date,
      word: e.word,
      imageUrl,
      score: c?.score ?? null,
      subjectPct: c?.subjectPercentEstimate ?? null,
      verdict: c?.verdict ?? 'unknown',
      photoSubject: c?.photoSubject ?? null,
      critique: c?.critique ?? null,
      passed,
    });
    console.log(`  score=${c?.score} subj%=${c?.subjectPercentEstimate} verdict=${c?.verdict} -> ${passed ? 'PASS' : 'FAIL'}`);
  }

  // Sort failed entries worst-first (by score asc, then subjectPct asc)
  const failed = results.filter(r => !r.passed)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || (a.subjectPct ?? 0) - (b.subjectPct ?? 0));

  // Write audit report
  const audDir = path.join(ROOT, 'audits', 'image-audit');
  await fs.mkdir(audDir, { recursive: true });
  const lines = [
    `# Image audit, ${today}`,
    ``,
    `**Scanned:** ${results.length} entries`,
    `**Passed:** ${results.length - failed.length}`,
    `**Failed:** ${failed.length}`,
    ``,
    `Gate: score >= ${GATES.throwback.minScore} AND subject% >= ${GATES.throwback.minSubjectPct}.`,
    ``,
  ];
  if (failed.length > 0) {
    lines.push(`## Worst offenders, sorted by score asc`);
    lines.push(``);
    for (const r of failed) {
      lines.push(`### ${r.date}, ${r.word}`);
      lines.push(`- **Score:** ${r.score}/10, **Subject %:** ${r.subjectPct}, **Verdict:** ${r.verdict}`);
      if (r.photoSubject) lines.push(`- **Photo actually depicts:** ${r.photoSubject}`);
      if (r.critique) lines.push(`- **Critic note:** ${r.critique}`);
      lines.push(`- **URL:** ${r.imageUrl}`);
      lines.push(``);
    }
  }
  const reportPath = path.join(audDir, `${today}.md`);
  await fs.writeFile(reportPath, lines.join('\n'));
  console.log(`[image-audit] wrote ${reportPath}`);

  // Write machine-readable for admin
  const resultsPath = path.join(ROOT, 'data', 'image-audit-results.json');
  await fs.writeFile(resultsPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    scanned: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    gate: GATES.throwback,
    failures: failed,
  }, null, 2));
  console.log(`[image-audit] wrote ${resultsPath}`);

  // Auto-queue regens for top N worst (writes to data/regen-queue.json which
  // the regen-on-push workflow consumes one-at-a-time). Multiple dates can
  // be listed as comma-separated in the dates field.
  if (AUTO_QUEUE_TOP > 0 && failed.length > 0) {
    const topN = failed.slice(0, AUTO_QUEUE_TOP);
    const queuePath = path.join(ROOT, 'data', 'regen-queue.json');
    let existingQueue = null;
    try { existingQueue = JSON.parse(await fs.readFile(queuePath, 'utf8')); } catch {}
    if (existingQueue) {
      console.log(`[image-audit] regen-queue.json already exists. Not overwriting. Top failures:`);
      topN.forEach(r => console.log(`  - ${r.date} ${r.word} (score=${r.score}, photo=${r.photoSubject})`));
    } else {
      // Queue only the WORST single one. Subsequent regens get queued
      // automatically by the audit when re-run.
      const worst = topN[0];
      const queue = {
        dates: worst.date,
        subject_override: `${worst.word} clear isolated subject focused on the actual ${worst.word.split(',')[0].trim()}, NOT a generic photo, NOT a workshop, NOT a person dominating frame`,
        reason: `Wave 212 image-audit: current image actually depicts "${worst.photoSubject || 'unknown'}". Critic score ${worst.score}/10, subject%=${worst.subjectPct}.`,
      };
      await fs.writeFile(queuePath, JSON.stringify(queue, null, 2));
      console.log(`[image-audit] queued regen for ${worst.date} ${worst.word}`);
      if (topN.length > 1) {
        console.log(`[image-audit] ${topN.length - 1} other failures will queue after this one merges. Re-run audit to refresh.`);
      }
    }
  }

  console.log(`[image-audit] done. ${failed.length}/${results.length} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
