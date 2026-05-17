/**
 * Site health auto-fixer. Reads the latest health report markdown and attempts
 * to repair known fixable patterns. Runs AFTER scripts/site-health.js inside
 * the same workflow.
 *
 * Fixes:
 *   - Broken internal links: best-effort path repair (../, missing extension)
 *   - Banned-word violations in entries.json: replace with brand-approved alternative
 *   - Page titles >70 chars: trim to <=70 at a word boundary
 *
 * Refuses to touch anything that doesn't match a known pattern.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BANNED_REPLACEMENTS = {
  'an embodiment of': 'a clear instance of',
  'embodies': 'represents',
  'encapsulates': 'represents',
  'embodiment': 'instance',
  'transcends': 'exceeds',
  'tapestry': 'arrangement',
  'symphony': 'arrangement',
  'orchestrator': 'arranger',
  'captures the essence': 'shows the shape',
  'stands as a testament': 'is a clear sign',
  'in a sense': 'in one way',
};

async function findLatestHealthReport() {
  const auditsDir = path.join(ROOT, 'audits');
  const files = await fs.readdir(auditsDir);
  const healthFiles = files.filter(f => f.startsWith('health-') && f.endsWith('.md')).sort().reverse();
  if (healthFiles.length === 0) return null;
  return path.join(auditsDir, healthFiles[0]);
}

function parseSection(report, headingRegex) {
  const lines = report.split('\n');
  const items = [];
  let inSection = false;
  for (const line of lines) {
    if (headingRegex.test(line)) { inSection = true; continue; }
    if (inSection) {
      if (line.startsWith('## ')) break;
      if (line.startsWith('- ') || line.startsWith('* ')) items.push(line.slice(2));
    }
  }
  return items;
}

async function fixBrokenLinks(report, fixes) {
  // Items look like: `about/index.html` → `thiccc/` (expected: `about/thiccc`)
  const items = parseSection(report, /^## Broken internal links/);
  for (const item of items) {
    const m = item.match(/`([^`]+)` → `([^`]+)` \(expected: `([^`]+)`\)/);
    if (!m) continue;
    const [, file, brokenLink, expected] = m;
    const filePath = path.join(ROOT, file);
    let html;
    try { html = await fs.readFile(filePath, 'utf8'); }
    catch (e) { fixes.push({ kind: 'broken-link', skipped: true, file, reason: 'file unreadable' }); continue; }
    // Construct correct path: if expected starts with ../, use it; else try common repairs
    // Most common case: link missing the parent directory traversal
    // e.g., href="thiccc/" inside about/index.html should be href="../thiccc/"
    const dirsDeep = file.split('/').length - 1;
    const relPrefix = dirsDeep > 0 ? '../'.repeat(dirsDeep) : '';
    const candidates = [
      relPrefix + brokenLink,  // add ../ prefix
      brokenLink + 'index.html', // append index.html
      relPrefix + brokenLink + 'index.html',
    ];
    let fixed = false;
    for (const candidate of candidates) {
      const targetPath = path.join(path.dirname(filePath), candidate.replace(/index\.html$/, ''));
      const checkPath = candidate.endsWith('index.html') ? candidate.replace(/index\.html$/, '') : candidate;
      try {
        const stat = await fs.stat(path.join(path.dirname(filePath), checkPath));
        if (stat.isDirectory() || stat.isFile()) {
          // Replace href="brokenLink" with href="candidate"
          const before = `href="${brokenLink}"`;
          const after = `href="${candidate}"`;
          if (html.includes(before)) {
            html = html.replace(before, after);
            await fs.writeFile(filePath, html, 'utf8');
            fixes.push({ kind: 'broken-link', file, brokenLink, fixed: candidate });
            fixed = true;
            break;
          }
        }
      } catch (e) { /* not this candidate */ }
    }
    if (!fixed) fixes.push({ kind: 'broken-link', skipped: true, file, reason: 'no working candidate found' });
  }
}

async function fixBannedWordsInEntries(report, fixes) {
  // Items: `2026-05-14` (Kettledrum, Industrial), [definitions] "an embodiment of"
  const items = parseSection(report, /^## Banned-word violations in entries\.json/);
  if (items.length === 0) return;

  const entriesPath = path.join(ROOT, 'data', 'entries.json');
  const entries = JSON.parse(await fs.readFile(entriesPath, 'utf8'));
  let changed = false;
  for (const item of items) {
    const m = item.match(/`(\d{4}-\d{2}-\d{2})` \([^)]+\), \[([^\]]+)\] "([^"]+)"/);
    if (!m) { fixes.push({ kind: 'banned-word', skipped: true, item }); continue; }
    const [, date, field, phrase] = m;
    const replacement = BANNED_REPLACEMENTS[phrase.toLowerCase()];
    if (!replacement) { fixes.push({ kind: 'banned-word', skipped: true, date, phrase, reason: 'no known replacement' }); continue; }
    const entry = entries.find(e => e.date === date);
    if (!entry) { fixes.push({ kind: 'banned-word', skipped: true, date, reason: 'entry not found' }); continue; }
    // Apply to the named field. Definitions is array; example is string; etc.
    const target = entry[field];
    const applyReplace = (s) => {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return s.replace(re, replacement);
    };
    if (Array.isArray(target)) {
      entry[field] = target.map(applyReplace);
      changed = true;
    } else if (typeof target === 'string') {
      entry[field] = applyReplace(target);
      changed = true;
    } else { fixes.push({ kind: 'banned-word', skipped: true, date, field, reason: 'unexpected field type' }); continue; }
    fixes.push({ kind: 'banned-word', date, field, from: phrase, to: replacement });
  }
  if (changed) {
    await fs.writeFile(entriesPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  }
}

async function fixLongPageTitles(report, fixes) {
  // Items: `articles/the-case-for-functional-girth.html`, 71 chars
  const items = parseSection(report, /^## Page titles >70 chars/);
  for (const item of items) {
    const m = item.match(/`([^`]+)`, (\d+) chars/);
    if (!m) continue;
    const [, file] = m;
    const filePath = path.join(ROOT, file);
    let html;
    try { html = await fs.readFile(filePath, 'utf8'); }
    catch (e) { fixes.push({ kind: 'long-title', skipped: true, file, reason: 'file unreadable' }); continue; }
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) { fixes.push({ kind: 'long-title', skipped: true, file, reason: 'no title tag' }); continue; }
    const oldTitle = titleMatch[1];
    // Trim to <=70 at a word boundary, preserve ", Thiccctionary" suffix if present
    let newTitle = oldTitle;
    const suffix = ', Thiccctionary';
    if (oldTitle.endsWith(suffix)) {
      const base = oldTitle.slice(0, -suffix.length);
      // Try trimming the base intelligently
      let trimmedBase = base;
      // First try to remove "The " prefix
      if (base.startsWith('The ') && (base.length + suffix.length) > 70) trimmedBase = base.slice(4);
      // If still too long, truncate at last space within budget
      const budget = 70 - suffix.length;
      if (trimmedBase.length > budget) {
        trimmedBase = trimmedBase.slice(0, budget);
        const lastSpace = trimmedBase.lastIndexOf(' ');
        if (lastSpace > budget - 15) trimmedBase = trimmedBase.slice(0, lastSpace);
      }
      newTitle = trimmedBase + suffix;
    } else if (oldTitle.length > 70) {
      let trimmed = oldTitle.slice(0, 70);
      const lastSpace = trimmed.lastIndexOf(' ');
      if (lastSpace > 50) trimmed = trimmed.slice(0, lastSpace);
      newTitle = trimmed;
    }
    if (newTitle !== oldTitle && newTitle.length <= 70) {
      html = html.replace(`<title>${oldTitle}</title>`, `<title>${newTitle}</title>`);
      // Also update og:title if it matches
      html = html.replace(`property="og:title" content="${oldTitle}"`, `property="og:title" content="${newTitle}"`);
      await fs.writeFile(filePath, html, 'utf8');
      fixes.push({ kind: 'long-title', file, from: `${oldTitle} (${oldTitle.length})`, to: `${newTitle} (${newTitle.length})` });
    } else {
      fixes.push({ kind: 'long-title', skipped: true, file, reason: 'could not trim cleanly' });
    }
  }
}

async function main() {
  const reportPath = await findLatestHealthReport();
  if (!reportPath) { console.log('[autofix] no health report found'); return; }
  const report = await fs.readFile(reportPath, 'utf8');
  console.log(`[autofix] reading ${path.basename(reportPath)}`);

  const fixes = [];
  await fixBrokenLinks(report, fixes);
  await fixBannedWordsInEntries(report, fixes);
  await fixLongPageTitles(report, fixes);

  console.log(`\n[autofix] ${fixes.length} fix attempts:`);
  for (const f of fixes) {
    if (f.skipped) console.log(`  SKIP [${f.kind}] ${JSON.stringify(f)}`);
    else console.log(`  FIX  [${f.kind}] ${JSON.stringify(f)}`);
  }

  // Write a log file the workflow can commit alongside the audit
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(ROOT, 'audits', `health-autofix-${date}.md`);
  const lines = [
    `# Site Health Auto-Fix Log, ${date}`,
    '',
    `Operated against: ${path.basename(reportPath)}`,
    '',
    `${fixes.filter(f => !f.skipped).length} fixes applied, ${fixes.filter(f => f.skipped).length} skipped.`,
    '',
    '## Applied',
    '',
    ...fixes.filter(f => !f.skipped).map(f => `- [${f.kind}] \`${JSON.stringify(f)}\``),
    '',
    '## Skipped',
    '',
    ...fixes.filter(f => f.skipped).map(f => `- [${f.kind}] \`${JSON.stringify(f)}\``),
  ];
  await fs.writeFile(logPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\n[autofix] wrote ${logPath}`);
}

main().catch(err => { console.error('[autofix] FATAL:', err); process.exit(1); });
