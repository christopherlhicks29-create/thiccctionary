/**
 * entries-io.js - the one place that knows how data/entries.json is written.
 *
 * Six scripts write this file. Four of them ended `JSON.stringify(entries, null, 2)`
 * and two of them appended a newline, so the last byte of a 200 KB file flipped
 * back and forth depending on which pipeline ran last -- a one-line diff on a
 * file nobody edited, showing up in commits that had nothing to do with it.
 *
 * The serialisation is not a fact worth typing six times. It lives here.
 *
 * No trailing newline: that is what is on disk today and what the majority of
 * writers already produced, so adopting it costs zero churn. The convention
 * matters far less than there being exactly one of it.
 */
import fs from 'fs';
import fsp from 'node:fs/promises';

export function serializeEntries(entries) {
  return JSON.stringify(entries, null, 2);
}

export function readEntriesSync(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeEntriesSync(file, entries) {
  fs.writeFileSync(file, serializeEntries(entries), 'utf8');
}

export async function writeEntries(file, entries) {
  await fsp.writeFile(file, serializeEntries(entries), 'utf8');
}
