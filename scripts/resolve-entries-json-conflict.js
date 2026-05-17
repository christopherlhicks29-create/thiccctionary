#!/usr/bin/env node
/**
 * Wave 148: field-aware data/entries.json conflict resolver.
 *
 * Used by .github/workflows/auto-resolve-conflicts.yml when a PR branch
 * conflicts with main on data/entries.json. Different generation pipelines
 * own different fields:
 *
 *   - regenerate-text/*  owns: word, pronunciation, partOfSpeech, definitions,
 *                              example, etymology
 *   - regenerate-images/* owns: caption, tags, image, photographer
 *   - daily/*             owns: a brand-new entry at the top of the list
 *
 * Run during a merge conflict: stage 2 = OURS (PR branch), stage 3 = THEIRS
 * (main). For each entry present in both, splice the PR's owned fields onto
 * main's version. Write the resolved file. Exit 0 on success, 1 if anything
 * looks ambiguous (caller falls back to human review).
 *
 * Usage: node scripts/resolve-entries-json-conflict.js <branchName>
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEXT_FIELDS = ['word', 'pronunciation', 'partOfSpeech', 'definitions', 'example', 'etymology'];
const IMAGE_FIELDS = ['caption', 'tags', 'image', 'photographer'];
const ALL_KNOWN = new Set([...TEXT_FIELDS, ...IMAGE_FIELDS, 'date', 'slug', 'category', 'socialCaptions', 'byline', 'critic', 'imagePrompt']);

function readSide(stage) {
  try {
    const out = execSync(`git show :${stage}:data/entries.json`, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    console.error(`Could not read stage ${stage}: ${e.message}`);
    return null;
  }
}

function entryKey(e) {
  return e.date || e.slug || `${e.word}|${e.date}`;
}

export function resolve(branch, oursOverride, theirsOverride) {
  const isText = branch.startsWith('regenerate-text/');
  const isImage = branch.startsWith('regenerate-images/');
  const isDaily = branch.startsWith('daily/');

  if (!isText && !isImage && !isDaily) {
    console.error(`Unsupported branch pattern for field-aware resolve: ${branch}`);
    return null;
  }

  const ours = oursOverride || readSide(2);
  const theirs = theirsOverride || readSide(3);
  if (!ours || !theirs) return null;

  const ourIndex = new Map(ours.map(e => [entryKey(e), e]));
  const theirIndex = new Map(theirs.map(e => [entryKey(e), e]));

  if (isDaily) {
    const merged = [];
    const seen = new Set();
    for (const e of ours) {
      const k = entryKey(e);
      seen.add(k);
      merged.push(theirIndex.has(k) ? theirIndex.get(k) : e);
    }
    for (const e of theirs) {
      const k = entryKey(e);
      if (!seen.has(k)) merged.push(e);
    }
    return merged;
  }

  const ownedFields = isText ? TEXT_FIELDS : IMAGE_FIELDS;
  const merged = theirs.map(mainEntry => {
    const k = entryKey(mainEntry);
    const prEntry = ourIndex.get(k);
    if (!prEntry) return mainEntry;
    const out = { ...mainEntry };
    for (const f of ownedFields) {
      if (f in prEntry) out[f] = prEntry[f];
    }
    return out;
  });

  for (const prEntry of ours) {
    for (const k of Object.keys(prEntry)) {
      if (!ALL_KNOWN.has(k)) {
        console.error(`Unknown field "${k}" on entry ${entryKey(prEntry)} - refusing to auto-resolve.`);
        return null;
      }
    }
  }

  return merged;
}

function main() {
  const branch = process.argv[2];
  if (!branch) {
    console.error('Usage: resolve-entries-json-conflict.js <branchName>');
    process.exit(2);
  }
  const resolved = resolve(branch);
  if (!resolved) {
    process.exit(1);
  }
  fs.writeFileSync('data/entries.json', JSON.stringify(resolved, null, 2) + '\n');
  console.log(`Resolved data/entries.json (${resolved.length} entries) using ${branch} ownership rules.`);
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main();
}
