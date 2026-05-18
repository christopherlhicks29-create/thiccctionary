#!/usr/bin/env node
/**
 * Wave 162: pre-ship quality gate.
 *
 * Run before committing or pushing. Walks the working tree diff vs HEAD
 * and applies rule checks for known failure modes that have bit us in
 * shipped waves:
 *
 *   - Em-dashes in source files (banned across the codebase since
 *     Wave 114, reinforced 2026-05-17)
 *   - JSON file must remain parseable
 *   - JS file must pass syntax check
 *   - YAML file must parse
 *   - HTML elements with `hidden` attribute + inline style "display: flex"
 *     (the Wave 156a PWA banner bug)
 *   - A new workflow file plus its sentinel-trigger path in the SAME
 *     commit (Wave 160 trap: workflow not yet in main when sentinel push
 *     arrives, so doesn't fire)
 *   - styles.css change without cache-buster bump in HTML referencing it
 *
 * Usage:
 *   node scripts/pre-ship-check.js              -> check files staged for commit
 *   node scripts/pre-ship-check.js --working    -> check ALL working-tree changes vs HEAD
 *
 * Exit code: 0 if clean, 1 if any rule failed.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args.includes('--working') ? 'working' : 'staged';

function gitDiff(diffArgs) {
  try {
    return execSync(`git diff ${diffArgs} --name-status`, { encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

const diff = mode === 'working' ? gitDiff('HEAD') : gitDiff('--cached');
const newFiles = [];     // status A
const changedFiles = []; // status M
const allFiles = [];
for (const line of diff.split('\n').filter(Boolean)) {
  const [status, ...rest] = line.split('\t');
  const file = rest.join('\t');
  if (status === 'A') newFiles.push(file);
  if (status === 'M' || status === 'A') changedFiles.push(file);
  if (status !== 'D') allFiles.push(file);
}

if (allFiles.length === 0) {
  console.log('[preship] no files to check (' + mode + ' mode).');
  process.exit(0);
}

const failures = [];
function fail(file, rule, msg) { failures.push({ file, rule, msg }); }

// Rule 1: em-dash scan.
// Allowed: comments / docstrings inside .js that reference em-dash regex
// stripping (we strip them from LLM output). Allowed: pre-existing JSDoc
// header comment lines.
const EMDASH_ALLOW = [
  /\.replace\(.*—/,       // em-dash strip regex
  /banned-pattern.*—/i,   // banned-pattern documentation
  /em-dash/i,             // talking about em-dashes
  /^---$/m,               // markdown horizontal rules (front matter etc)
];
for (const f of allFiles) {
  if (!/\.(html|js|md|mjs|yml|yaml|css|json)$/.test(f)) continue;
  if (f.endsWith('pre-ship-check.js')) continue; // self-reference; this file defines the rule
  if (f.startsWith('audits/')) continue; // audit reports legitimately quote em-dash content they flag
  if (!fs.existsSync(f)) continue;
  // Only scan LINES I'm adding/modifying, not the whole file. WAVES.md and
  // similar historical logs have pre-Wave-114 em-dashes that are frozen
  // and should not retroactively flag.
  const diffOutput = (() => {
    try {
      const arg = mode === 'working' ? `HEAD -- ${f}` : `--cached -- ${f}`;
      return execSync(`git diff --unified=0 ${arg}`, { encoding: 'utf8' });
    } catch (e) { return ''; }
  })();
  // For brand-new files, scan the entire content; for modifications, only the + lines.
  const isNew = newFiles.includes(f);
  const linesToCheck = isNew
    ? fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ line, lineNo: i + 1 }))
    : diffOutput.split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++'))
        .map(l => ({ line: l.slice(1), lineNo: null }));
  for (const { line, lineNo } of linesToCheck) {
    if (!line.includes('—')) continue;
    const allowed = EMDASH_ALLOW.some(r => r.test(line));
    if (!allowed) fail(f, 'em-dash', `${lineNo ? 'line ' + lineNo + ': ' : ''}${line.slice(0, 100)}`);
  }
}

// Rule 2: JSON files must parse
for (const f of allFiles) {
  if (!f.endsWith('.json')) continue;
  if (!fs.existsSync(f)) continue;
  try { JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { fail(f, 'json-parse', e.message); }
}

// Rule 3: JS syntax
for (const f of allFiles) {
  if (!/\.(js|mjs)$/.test(f)) continue;
  if (!fs.existsSync(f)) continue;
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
  catch (e) { fail(f, 'js-syntax', e.stderr?.toString().slice(0, 300) || e.message); }
}

// Rule 4: YAML parses (use python yaml)
for (const f of allFiles) {
  if (!/\.ya?ml$/.test(f)) continue;
  if (!fs.existsSync(f)) continue;
  try {
    execSync(`python3 -c "import yaml; yaml.safe_load(open('${f}'))"`, { stdio: 'pipe' });
  } catch (e) {
    fail(f, 'yaml-parse', e.stderr?.toString().slice(0, 300) || e.message);
  }
}

// Rule 5: HTML elements with hidden + inline display: flex
// (specificity conflict that silently breaks .hidden = true)
for (const f of allFiles) {
  if (!f.endsWith('.html')) continue;
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf8');
  const tagRe = /<[a-z][^>]*?>/gi;
  let match;
  while ((match = tagRe.exec(content)) !== null) {
    const tag = match[0];
    if (!/\bhidden\b/.test(tag)) continue;
    if (!/style="[^"]*display:\s*flex/.test(tag)) continue;
    const lineNum = content.slice(0, match.index).split('\n').length;
    fail(f, 'pwa-banner-bug', `line ${lineNum}: element has both hidden + style="display: flex". Setting hidden=true silently fails. Use style.display = 'none' instead.`);
  }
}

// Rule 6: workflow + sentinel co-creation guard
const workflowFiles = newFiles.filter(f => f.startsWith('.github/workflows/') && f.endsWith('.yml'));
const sentinelFiles = newFiles.filter(f => f.startsWith('data/.fire-'));
for (const wf of workflowFiles) {
  if (!fs.existsSync(wf)) continue;
  const wfContent = fs.readFileSync(wf, 'utf8');
  for (const sent of sentinelFiles) {
    if (wfContent.includes(sent)) {
      fail(wf, 'workflow-sentinel-co-create', `This commit adds workflow ${wf} AND its sentinel ${sent}. GitHub Actions doesn't reliably fire workflows on the same push that creates them. Split into two commits or use workflow_dispatch directly.`);
    }
  }
}

// Rule 7: styles.css change without cache-buster bump
const stylesChanged = changedFiles.includes('styles.css');
if (stylesChanged) {
  // Grab the current ?v=NN from index.html on disk
  try {
    const home = fs.readFileSync('index.html', 'utf8');
    const m = home.match(/styles\.css\?v=(\d+)/);
    const currentV = m ? parseInt(m[1], 10) : null;
    // Was the cache-buster bumped in this diff?
    const indexDiff = mode === 'working'
      ? execSync('git diff HEAD -- index.html', { encoding: 'utf8' })
      : execSync('git diff --cached -- index.html', { encoding: 'utf8' });
    const bumped = /^\+.*styles\.css\?v=/m.test(indexDiff);
    if (!bumped) {
      fail('styles.css', 'cache-buster-bump', `styles.css changed but the ?v=${currentV} query-param wasn't bumped in HTML files. Visitors will keep getting the cached old stylesheet.`);
    }
  } catch (_) { /* index.html unreadable; skip */ }
}

// Report
console.log(`[preship] checked ${allFiles.length} file(s) in ${mode} mode`);
if (failures.length === 0) {
  console.log('[preship] all checks passed.');
  process.exit(0);
}
console.log(`[preship] ${failures.length} failure(s):\n`);
for (const f of failures) {
  console.log(`  ${f.file} [${f.rule}]: ${f.msg}`);
}
console.log('\n[preship] FAIL. Fix the issues above or override with --no-verify on git.');
process.exit(1);
