#!/usr/bin/env node
/**
 * sync-plate-numbers.js - Wave 314
 *
 * 76 of 106 entry pages shipped with the literal words "Plate N." under the
 * photograph -- the template placeholder, visible to every reader, sitting
 * where a plate number belongs. Wave 307 stopped new entries doing it but did
 * not go back for the ones already written, and regenerate-text.js reintroduces
 * it every time it rewrites an entry.
 *
 * This reconciles stored captions against scripts/lib/plate.js, which derives
 * the number from the entry's chronological position. It rewrites a caption
 * whose prefix disagrees with the derived number, not merely one that says "N",
 * so an entry inserted into the middle of the archive renumbers the ones after
 * it instead of quietly leaving two Plate LXI's in the file.
 *
 * It also covers the hand-written articles, whose figcaptions carry the same
 * prefix. An article's plate number is not free-standing either: it is the
 * number of the entry whose photograph the article is showing, which the image
 * filename already states.
 *
 * Idempotent: a second run over a file it just fixed changes nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toRomanNumeral, plateNumberFor, withPlateNumber } from './lib/plate.js';
import { readEntriesSync, writeEntriesSync } from './lib/entries-io.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'entries.json');

const entries = readEntriesSync(FILE);

let changed = 0, already = 0, skipped = 0;
const samples = [];

for (const entry of entries) {
  if (typeof entry.caption !== 'string' || !entry.caption.trim()) { skipped++; continue; }
  const num = plateNumberFor(entry, entries);
  if (!num) { skipped++; continue; }
  const want = withPlateNumber(entry.caption, num);
  if (want === entry.caption) { already++; continue; }
  if (samples.length < 5) {
    samples.push(`  ${entry.date}: ${entry.caption.slice(0, 34)}...  ->  Plate ${toRomanNumeral(num)}.,`);
  }
  entry.caption = want;
  changed++;
}

if (changed) {
  // Via entries-io, not JSON.stringify inline: this file's serialisation had
  // drifted between its six writers, and a reconciler that reformats 200 KB to
  // fix 76 captions is worse than the bug it fixes.
  writeEntriesSync(FILE, entries);
  for (const s of samples) console.log(s);
}
console.log(changed === 0
  ? `[plate] ${already} caption(s), all already numbered correctly.${skipped ? ` ${skipped} skipped.` : ''}`
  : `[plate] ${changed} caption(s) renumbered, ${already} already correct.${skipped ? ` ${skipped} skipped.` : ''}`);

// --- articles -------------------------------------------------------------
// A figcaption opening with a plate prefix belongs to the entry whose photo the
// figure shows. The <img src> names that entry's date, so read it from there
// rather than asking the author to keep two numbers in step.
const ART = path.join(ROOT, 'articles');
const FIG = /(<img\b[^>]*\bsrc="[^"]*?(\d{4}-\d{2}-\d{2})-[^"]*"[^>]*>\s*<figcaption\b[^>]*>)(Plate\s+[^.]{1,10}\.,?\s*)/g;
let aFixed = 0, aOk = 0;

for (const name of fs.readdirSync(ART)) {
  if (!name.endsWith('.html')) continue;
  const file = path.join(ART, name);
  const html = fs.readFileSync(file, 'utf8');
  const next = html.replace(FIG, (whole, head, date) => {
    const num = plateNumberFor({ date }, entries);
    return num ? `${head}Plate ${toRomanNumeral(num)}., ` : whole;
  });
  if (next === html) { aOk++; continue; }
  fs.writeFileSync(file, next);
  console.log(`  ${name}: figcaption renumbered.`);
  aFixed++;
}

console.log(aFixed === 0
  ? `[plate] ${aOk} article(s), no figcaption numbering to correct.`
  : `[plate] ${aFixed} article figcaption(s) renumbered, ${aOk} already correct.`);
