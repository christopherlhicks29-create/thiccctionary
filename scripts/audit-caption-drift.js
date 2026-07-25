/**
 * audit-caption-drift.js - which captions describe a photograph that is no
 * longer there.
 *
 * Wave 329. The caption under a plate is prose about the picture above it, and
 * until this wave nothing rewrote it when the picture changed: regenerate-text
 * discards the caption by design, regenerate-images never mentioned the field.
 * So the caption was owned by the original generate-daily run and by nothing
 * else, and every reshoot since has been a chance for it to drift.
 *
 * Wave 329 stops new drift. It cannot fix the drift already on disk, because
 * knowing whether "Close-up of a drum head" describes the photograph now at
 * that path requires looking at the photograph. What a script CAN do is say
 * which entries are even capable of being wrong, and it can do that exactly:
 * walk the history of data/entries.json and find every entry whose `image`
 * changed more recently than its `caption`.
 *
 * That is a suspect list, not a defect list. A generic caption ("Marine diesel
 * crankshaft at rest") survives a reshoot of the same object perfectly well.
 * The value is that the list is finite, ordered, and shrinks: a Wave 329 regen
 * rewrites the caption, so an entry leaves this list the moment it is reshot.
 *
 * Run: node scripts/audit-caption-drift.js
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'data/entries.json';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

function snapshotAt(rev) {
  try {
    const parsed = JSON.parse(git(['show', `${rev}:${FILE}`]));
    return Array.isArray(parsed) ? parsed : parsed.entries;
  } catch {
    return null;  // the file did not exist yet, or was mid-rewrite at that commit
  }
}

export function findCaptionDrift() {
  // Oldest first, so "more recent" is just a larger index.
  const revs = git(['log', '--format=%H', '--', FILE]).trim().split('\n').filter(Boolean).reverse();

  const imageChangedAt = new Map();
  const captionChangedAt = new Map();
  let previous = new Map();

  revs.forEach((rev, i) => {
    const rows = snapshotAt(rev);
    if (!rows) return;
    const current = new Map();
    for (const r of rows) {
      if (!r || !r.date) continue;
      current.set(r.date, { image: r.image, caption: r.caption, word: r.word });
      const was = previous.get(r.date);
      // A field that appears for the first time is the entry being created, not
      // a change: an entry born with both fields set is in agreement by
      // definition, and counting that as a caption edit would hide real drift.
      if (!was) continue;
      if (r.image !== was.image) imageChangedAt.set(r.date, i);
      if (r.caption !== was.caption) captionChangedAt.set(r.date, i);
    }
    previous = current;
  });

  const drifted = [];
  for (const [date, imageAt] of imageChangedAt) {
    const capAt = captionChangedAt.has(date) ? captionChangedAt.get(date) : -1;
    if (capAt < imageAt) {
      const e = previous.get(date) || {};
      drifted.push({ date, word: e.word, caption: e.caption, image: e.image });
    }
  }
  drifted.sort((a, b) => a.date.localeCompare(b.date));
  return { reshot: imageChangedAt.size, drifted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { reshot, drifted } = findCaptionDrift();
  console.log(`${reshot} entries have had their photograph replaced at least once.`);
  console.log(`${drifted.length} of those carry a caption older than the photograph it describes.\n`);
  for (const d of drifted) {
    console.log(`  ${d.date}  ${d.word}`);
    console.log(`      ${d.caption}`);
  }
  if (drifted.length) {
    console.log('\nThis is a SUSPECT list. A caption generic enough to survive a reshoot is');
    console.log('fine; one naming what the old photograph showed is not. Confirming needs');
    console.log('eyes on the image. Reshooting an entry clears it automatically (Wave 329).');
  }
}
