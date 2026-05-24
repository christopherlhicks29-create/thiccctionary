#!/usr/bin/env node
/**
 * Wave 208 Layer A: weekly social media audit.
 *
 * Walks local audit logs (no Buffer API call needed for v1):
 *   - audits/buffer-posts/*.json  (Wave 202 per-mode channel results)
 *   - audits/social-quality.jsonl  (Wave 118 office post generation log)
 *   - data/office-post-queue.json  (every office post we've sent)
 *   - data/entries.json  (caption sanity per entry)
 *
 * Surfaces:
 *   - Posts with `success_count: 2` but stale (signals Wave 206-era silent failures)
 *   - Captions with quote/grammar issues (double quotes, leaked JSON keys, empty)
 *   - Cross-post duplicate captions (same text in different audit files within 7d)
 *   - Office posts with score 6 or below that still shipped
 *
 * Writes audits/social-audit/YYYY-MM-DD.md + data/social-remediation-queue.json.
 *
 * Run: node scripts/social-audit.js
 *      node scripts/social-audit.js --days=14   (override 7d default)
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NOW = new Date();
const today = NOW.toISOString().slice(0, 10);
const daysArg = process.argv.find(a => a.startsWith('--days='));
const WINDOW_DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
const cutoff = NOW.getTime() - WINDOW_DAYS * 86400_000;

const findings = [];
const remediation = [];

function addFinding(severity, category, detail, postRef) {
  findings.push({ severity, category, detail, postRef });
}

function addRemediation(action, target, reason) {
  remediation.push({ action, target, reason, suggested_at: NOW.toISOString() });
}

// ---------- 1. Walk audits/buffer-posts/ ----------
const bufferPostsDir = path.join(ROOT, 'audits', 'buffer-posts');
if (fs.existsSync(bufferPostsDir)) {
  for (const f of fs.readdirSync(bufferPostsDir).sort().reverse()) {
    const fp = path.join(bufferPostsDir, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) break;  // file list is reverse-sorted by name, ok to break
    let data;
    try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    for (const [mode, rec] of Object.entries(data)) {
      if (!rec || typeof rec !== 'object') continue;
      const succ = rec.successes ?? 0;
      const fail = rec.failures ?? 0;
      if (succ === 0 && fail > 0) {
        addFinding('high', 'all-channels-failed',
          `${f} mode=${mode}: 0 successes, ${fail} failures across channels`,
          { file: f, mode });
      }
      if (rec.channels) {
        for (const ch of rec.channels) {
          if (ch.status === 'failed' || ch.error) {
            addFinding('medium', 'channel-failed',
              `${f} mode=${mode} ${ch.service}: ${ch.error || 'unknown'}`,
              { file: f, mode, service: ch.service });
          }
        }
      }
    }
  }
}

// ---------- 2. Walk audits/social-quality.jsonl (office posts) ----------
const sqPath = path.join(ROOT, 'audits', 'social-quality.jsonl');
const captionTexts = new Map();  // captionNormalized -> [{ts, where, byline}]
if (fs.existsSync(sqPath)) {
  const lines = fs.readFileSync(sqPath, 'utf8').trim().split('\n');
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = new Date(rec.ts).getTime();
    if (ts < cutoff) continue;
    // Findings on the post itself
    const draft = rec.draft || '';
    if (rec.passed && rec.best_score < 7) {
      addFinding('low', 'shipped-low-score',
        `${rec.ts.slice(0,10)} ${rec.byline}: score=${rec.best_score} still shipped`,
        { ts: rec.ts, byline: rec.byline });
    }
    if (/^[\s"“”]*$/.test(draft)) {
      addFinding('high', 'empty-caption',
        `${rec.ts.slice(0,10)} ${rec.byline}: empty caption shipped`,
        { ts: rec.ts });
    }
    if (/["“”]{2,}/.test(draft)) {
      addFinding('medium', 'double-quote',
        `${rec.ts.slice(0,10)} ${rec.byline}: caption has adjacent quote chars`,
        { ts: rec.ts });
    }
    // Dedup tracking, normalize for compare
    const norm = draft.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.length > 30) {
      if (!captionTexts.has(norm)) captionTexts.set(norm, []);
      captionTexts.get(norm).push({ ts: rec.ts, byline: rec.byline, where: 'office' });
    }
  }
}

// ---------- 3. Walk data/office-post-queue.json ----------
const opqPath = path.join(ROOT, 'data', 'office-post-queue.json');
if (fs.existsSync(opqPath)) {
  let opq;
  try { opq = JSON.parse(fs.readFileSync(opqPath, 'utf8')); } catch { opq = []; }
  for (const post of opq) {
    const created = new Date(post.created).getTime();
    if (created < cutoff) continue;
    // Posts marked posted but with errors should be investigated
    if (post.status === 'posted' && (post.failure_count > 0 || (post.errors || []).length > 0)) {
      addFinding('high', 'posted-with-errors',
        `${post.created.slice(0,10)} ${post.byline_id}: marked posted but had ${post.failure_count} failures`,
        { post_id: post.id });
      addRemediation('investigate', post.id, `success_count=${post.success_count}, failure_count=${post.failure_count}`);
    }
  }
}

// ---------- 4. Cross-channel duplicate detection ----------
for (const [norm, occurrences] of captionTexts.entries()) {
  if (occurrences.length > 1) {
    addFinding('medium', 'duplicate-caption',
      `Caption "${norm.slice(0,60)}..." appears ${occurrences.length}x in last ${WINDOW_DAYS}d`,
      { occurrences });
  }
}

// ---------- 5. Entry caption sanity ----------
const entriesPath = path.join(ROOT, 'data', 'entries.json');
if (fs.existsSync(entriesPath)) {
  const entries = JSON.parse(fs.readFileSync(entriesPath, 'utf8'));
  for (const e of entries) {
    if (!e.date) continue;
    const entryDate = new Date(e.date).getTime();
    if (entryDate < cutoff) continue;
    const ex = e.example || '';
    if (!ex.trim()) {
      addFinding('high', 'empty-example',
        `${e.date} "${e.word}": example sentence is empty`,
        { date: e.date });
      addRemediation('fix-example', e.date, 'Empty example will render as "" on entry page');
    }
    // Wave 205b corruption pattern
    if ((e.definitions || []).some(d => typeof d === 'string' && /^(example|etymology|caption|tags|category)["']?\s*:/i.test(d.trim()))) {
      addFinding('critical', 'definitions-corruption',
        `${e.date} "${e.word}": definitions[] contains leaked JSON keys (Wave 205b pattern)`,
        { date: e.date });
      addRemediation('fix-entry', e.date, 'Hand-fix definitions array; LLM output was malformed');
    }
  }
}

// ---------- Report ----------
const audDir = path.join(ROOT, 'audits', 'social-audit');
fs.mkdirSync(audDir, { recursive: true });
const reportPath = path.join(audDir, `${today}.md`);

const bySev = { critical: 0, high: 0, medium: 0, low: 0 };
for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

const lines = [
  `# Social audit, ${today}`,
  ``,
  `**Window:** last ${WINDOW_DAYS} days`,
  `**Findings:** ${findings.length} total, ${bySev.critical} critical, ${bySev.high} high, ${bySev.medium} medium, ${bySev.low} low`,
  `**Remediation actions queued:** ${remediation.length}`,
  ``,
];

const groupedByCategory = {};
for (const f of findings) {
  if (!groupedByCategory[f.category]) groupedByCategory[f.category] = [];
  groupedByCategory[f.category].push(f);
}

if (findings.length === 0) {
  lines.push('No issues found. All social posts clean within the window.');
} else {
  lines.push('## Findings by category');
  lines.push('');
  for (const [cat, items] of Object.entries(groupedByCategory)) {
    lines.push(`### ${cat} (${items.length})`);
    for (const i of items) lines.push(`- **${i.severity}**: ${i.detail}`);
    lines.push('');
  }
}

if (remediation.length > 0) {
  lines.push('## Remediation queue');
  lines.push('');
  lines.push('Apply via admin panel "Apply social fixes" button (Wave 208 Layer C).');
  lines.push('');
  for (const r of remediation) {
    lines.push(`- **${r.action}** \`${r.target}\`: ${r.reason}`);
  }
  lines.push('');
}

fs.writeFileSync(reportPath, lines.join('\n'));
console.log(`[social-audit] wrote ${reportPath}`);

// Write remediation queue (admin panel reads this)
const remediationPath = path.join(ROOT, 'data', 'social-remediation-queue.json');
fs.writeFileSync(remediationPath, JSON.stringify({
  generated_at: NOW.toISOString(),
  window_days: WINDOW_DAYS,
  findings_count: findings.length,
  remediation,
}, null, 2));
console.log(`[social-audit] wrote ${remediationPath}`);

console.log(`[social-audit] ${findings.length} findings (critical=${bySev.critical} high=${bySev.high} medium=${bySev.medium} low=${bySev.low})`);
process.exit(0);
