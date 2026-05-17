/**
 * Refill data/subject-queue.json from data/thiccc-noun-pool.json when the queue runs low.
 *
 * Runs as a step in daily.yml BEFORE generate-daily.js. If subject-queue.json has
 * < REFILL_THRESHOLD items, pulls REFILL_BATCH random unused subjects from the pool
 * and pushes them onto the queue. Uses entries.json + the open daily/* PR set to
 * avoid re-picking subjects we've already used or have queued elsewhere.
 *
 * Pool items have shape: { subject, query, category, notes? }
 * Queue items are the same shape, generate-daily.js (Wave 73) honors `query` and
 * falls back to auto-deriving from subject if absent.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POOL_PATH = path.join(ROOT, 'data', 'thiccc-noun-pool.json');
const QUEUE_PATH = path.join(ROOT, 'data', 'subject-queue.json');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');

const REFILL_THRESHOLD = 3;
const REFILL_BATCH = 5;

function pickN(arr, n) {
  const copy = [...arr];
  const picked = [];
  while (picked.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(i, 1)[0]);
  }
  return picked;
}

function firstWord(s) {
  return String(s || '').split(/[,\s]+/)[0].toLowerCase();
}

async function main() {
  const pool = JSON.parse(await fs.readFile(POOL_PATH, 'utf8'));
  const queue = JSON.parse(await fs.readFile(QUEUE_PATH, 'utf8').catch(() => '{"queue":[]}'));
  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8').catch(() => '[]'));

  const currentQueueLength = Array.isArray(queue.queue) ? queue.queue.length : 0;
  if (currentQueueLength >= REFILL_THRESHOLD) {
    console.log(`Queue has ${currentQueueLength} items (≥ ${REFILL_THRESHOLD}). No refill needed.`);
    return;
  }

  // Build set of subjects we should NOT re-add to the queue
  const usedFirstWords = new Set();
  for (const e of entries) usedFirstWords.add(firstWord(e.word));
  for (const q of (queue.queue || [])) {
    const subj = typeof q === 'string' ? q : (q?.subject || '');
    usedFirstWords.add(firstWord(subj));
  }

  // Filter pool to candidates we haven't used yet (by first-word collision check)
  const candidates = pool.pool.filter(p => !usedFirstWords.has(firstWord(p.subject)));
  console.log(`Pool: ${pool.pool.length} total, ${candidates.length} unused.`);

  if (candidates.length === 0) {
    console.warn('No unused subjects in pool. Consider adding more to data/thiccc-noun-pool.json.');
    return;
  }

  const toAdd = pickN(candidates, REFILL_BATCH);
  const newQueue = {
    ...queue,
    queue: [...(queue.queue || []), ...toAdd],
  };

  await fs.writeFile(QUEUE_PATH, JSON.stringify(newQueue, null, 2));
  console.log(`Refilled queue with ${toAdd.length} subjects:`);
  for (const item of toAdd) console.log(`  + ${item.subject} (query: "${item.query}")`);
  console.log(`Queue now has ${newQueue.queue.length} items.`);
}

main().catch(err => { console.error(err); process.exit(1); });
