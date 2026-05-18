#!/usr/bin/env node
/**
 * Wave 163: heuristic stranger-legibility audit of the Buffer queue.
 *
 * Reads the most recent dump under audits/buffer-queue/*.json (produced
 * by the buffer-queue.js list action) and applies cheap heuristics to
 * flag posts that may fail the stranger-legibility test:
 *
 *   - Banned openers from generate-office-post.js system prompt
 *   - Em-dashes (Wave 114 ban)
 *   - Posts that reference fictional names without setting up the situation
 *   - Posts containing banned brand-voice phrases
 *
 * Output: audits/buffer-queue-legibility/<stamp>.md with one row per
 * post, status flag, reasons. The admin Social tab can render this.
 *
 * Does NOT require any API calls; runs entirely from disk.
 *
 * Usage: node scripts/audit-buffer-queue.js [path/to/dump.json]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BANNED_OPENERS = [
  /^The [A-Z][a-z]+ marched/i,
  /^There is a particular kind of/i,
  /^Consider the/i,
  /^One submits,/i,
  /^This writer notes/i,
  /^Few objects/i,
];

const BANNED_PHRASES = [
  'embodies', 'encapsulates', 'intersection', 'transcends', 'tapestry',
  'symphony', 'captures the essence', 'stands as a testament',
];

const NOT_JUST_X_BUT_Y = /not just\s+\w+,\s*but/i;

// Fictional names that NEED situational setup (vs cast names that build over time).
// These are character names we've used but that aren't yet anchored in the bible.
const ORPHAN_NAMES = [
  'Phillipa Reuss-Fontaine', 'Phillipa',
  'Uncle Bertram', 'Bertram',
  'Reginald',
  'Philippe Marchand',
];

async function findLatestDump() {
  const dir = path.join(ROOT, 'audits', 'buffer-queue');
  const files = await fs.readdir(dir);
  const jsonFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(f));
  if (jsonFiles.length === 0) return null;
  jsonFiles.sort();
  return path.join(dir, jsonFiles[jsonFiles.length - 1]);
}

function scorePost(post) {
  const text = post.text || '';
  const reasons = [];

  // Banned openers
  for (const re of BANNED_OPENERS) {
    if (re.test(text)) reasons.push(`banned opener: ${re}`);
  }

  // Em-dashes
  if (text.includes('—')) reasons.push('contains em-dash (Wave 114 ban)');

  // Banned phrases
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) reasons.push(`banned phrase: "${phrase}"`);
  }

  // Not just X but Y construction
  if (NOT_JUST_X_BUT_Y.test(text)) reasons.push('not-just-X-but-Y construction');

  // Orphan names without setup
  for (const name of ORPHAN_NAMES) {
    if (text.includes(name)) {
      // Check if there's any setup nearby (rough heuristic: name preceded by an attribution verb)
      const idx = text.indexOf(name);
      const before = text.slice(Math.max(0, idx - 60), idx).toLowerCase();
      const hasSetup = /\b(says|wrote|noted|files|filed|emailed|argued)\s/.test(before);
      if (!hasSetup) reasons.push(`opaque name without setup: "${name}"`);
    }
  }

  // Length check (Buffer caps + readability)
  if (text.length > 500) reasons.push(`unusually long (${text.length} chars)`);

  return reasons;
}

function flagLevel(reasons) {
  if (reasons.length === 0) return 'OK';
  if (reasons.some(r => r.startsWith('opaque name') || r.startsWith('banned opener') || r.startsWith('contains em-dash'))) return 'BLOCK';
  return 'WARN';
}

async function main() {
  const customPath = process.argv[2];
  const dumpPath = customPath ? path.resolve(customPath) : await findLatestDump();
  if (!dumpPath) {
    console.error('[audit] no Buffer queue dump found. Fire `buffer-list` first.');
    process.exit(1);
  }
  console.log(`[audit] reading ${dumpPath}`);
  const posts = JSON.parse(await fs.readFile(dumpPath, 'utf8'));
  if (!Array.isArray(posts)) {
    console.error('[audit] dump is not an array');
    process.exit(1);
  }

  const results = posts.map((p, i) => ({
    index: i,
    id: p.id,
    channelId: p.channelId,
    dueAt: p.dueAt,
    text: p.text || '',
    reasons: scorePost(p),
  }));

  const blocks = results.filter(r => flagLevel(r.reasons) === 'BLOCK');
  const warns = results.filter(r => flagLevel(r.reasons) === 'WARN');
  const oks = results.filter(r => flagLevel(r.reasons) === 'OK');

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
  const outDir = path.join(ROOT, 'audits', 'buffer-queue-legibility');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${stamp}.md`);

  const lines = [];
  lines.push(`# Buffer queue stranger-legibility audit\n`);
  lines.push(`Source: \`${path.relative(ROOT, dumpPath)}\``);
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push(`**${posts.length} posts** in queue. **${blocks.length} BLOCK**, **${warns.length} WARN**, **${oks.length} OK**.\n`);

  if (blocks.length > 0) {
    lines.push(`## BLOCK (recommend purge)\n`);
    for (const r of blocks) {
      lines.push(`### ${r.dueAt?.slice(0, 16) || '?'} - id ${r.id}`);
      lines.push(`Reasons: ${r.reasons.join('; ')}\n`);
      lines.push('```');
      lines.push(r.text);
      lines.push('```\n');
    }
  }

  if (warns.length > 0) {
    lines.push(`## WARN (manual review)\n`);
    for (const r of warns) {
      lines.push(`### ${r.dueAt?.slice(0, 16) || '?'} - id ${r.id}`);
      lines.push(`Reasons: ${r.reasons.join('; ')}\n`);
      lines.push('```');
      lines.push(r.text);
      lines.push('```\n');
    }
  }

  lines.push(`## OK (${oks.length} posts not shown)\n`);
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');
  console.log(`[audit] wrote ${path.relative(ROOT, outPath)}`);
  console.log(`[audit] BLOCK ${blocks.length}, WARN ${warns.length}, OK ${oks.length}`);

  // Also print the BLOCK and WARN summaries to stdout
  if (blocks.length > 0) {
    console.log(`\n--- BLOCK posts ---`);
    for (const r of blocks) {
      console.log(`  [${r.index}] ${r.dueAt?.slice(0, 16)} id=${r.id}`);
      console.log(`    text: ${r.text.split('\n')[0].slice(0, 100)}`);
      console.log(`    reasons: ${r.reasons.join('; ')}`);
    }
  }
}

main().catch(e => { console.error('[audit] FATAL:', e); process.exit(1); });
