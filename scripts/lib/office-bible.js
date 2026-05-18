/**
 * Wave 162: office bible accessor.
 *
 * Loads data/office-history.json and produces concise context snippets for
 * the post generators. Each call returns a compact text block (target
 * < 800 tokens worth) the generators paste into their Claude/GPT prompt.
 *
 * If the bible file is missing or unreadable, returns empty strings.
 * Generators must tolerate missing bible (don't crash; fall back to
 * staff bible only).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BIBLE_PATH = path.join(ROOT, 'data', 'office-history.json');

let _cached = null;
async function loadBibleCached() {
  if (_cached !== null) return _cached;
  try {
    const text = await fs.readFile(BIBLE_PATH, 'utf8');
    _cached = JSON.parse(text);
  } catch (e) {
    _cached = false; // sentinel: tried, failed
  }
  return _cached;
}

function pairKey(a, b) {
  return [a, b].sort().join(':');
}

/**
 * Return a compact context block for posts/comments BY this byline.
 * Optionally narrow to ONE other byline (e.g. for an article comment by
 * Bart commenting on Eli's piece, you'd call contextFor('bart', 'eli')).
 *
 * Returns a string. Empty if bible missing.
 */
export async function contextFor(bylineId, otherBylineId = null) {
  const bible = await loadBibleCached();
  if (!bible) return '';

  const out = [];

  // 1. Relationships involving this byline
  const myRels = (bible.relationships || []).filter(r => r.pair.includes(bylineId));
  if (myRels.length > 0) {
    out.push(`RELATIONSHIPS (this byline's dynamics):`);
    for (const r of myRels) {
      const partner = r.pair.find(p => p !== bylineId);
      // If we're narrowing to a specific other byline, emphasize that pair
      const narrowing = otherBylineId && r.pair.includes(otherBylineId);
      const prefix = narrowing ? '** ' : '   ';
      out.push(`${prefix}${bylineId} <-> ${partner}: ${r.one_line}`);
      if (r.current_state) out.push(`${prefix}  CURRENT: ${r.current_state}`);
    }
    out.push('');
  }

  // 2. Recent events involving this byline (last 90 days, max 6)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const myEvents = (bible.events || [])
    .filter(e => e.participants.includes(bylineId))
    .filter(e => e.date >= ninetyDaysAgo)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  if (myEvents.length > 0) {
    out.push(`RECENT EVENTS (chronological, newest first):`);
    for (const e of myEvents) {
      const others = e.participants.filter(p => p !== bylineId);
      const co = others.length > 0 ? ` w/ ${others.join('+')}` : '';
      out.push(`   ${e.date}${co}: ${e.summary}`);
    }
    out.push('');
  }

  // 3. Active tensions involving this byline (or both if narrowing)
  const myTensions = (bible.active_tensions || []).filter(t => {
    if (!t.involves) return false;
    if (otherBylineId) return t.involves.includes(bylineId) && t.involves.includes(otherBylineId);
    return t.involves.includes(bylineId);
  });
  if (myTensions.length > 0) {
    out.push(`ACTIVE TENSIONS (unresolved threads to draw from):`);
    for (const t of myTensions) {
      out.push(`   [${t.id}] ${t.summary}`);
    }
    out.push('');
  }

  if (out.length === 0) return '';

  return [
    'OFFICE BIBLE CONTEXT (internal continuity - never quote verbatim, infer from):',
    ...out,
    'IMPORTANT: a stranger reading this post should be able to parse what happened from the surrounding sentence alone. The bible gives YOU continuity; the reader gets just enough to follow.',
  ].join('\n');
}

/**
 * Return a list of active-tension IDs the generator can ask Claude to pick
 * one from. Useful when the generator wants to seed a post around an
 * ongoing thread.
 */
export async function listActiveTensions() {
  const bible = await loadBibleCached();
  if (!bible) return [];
  return (bible.active_tensions || []).map(t => ({ id: t.id, summary: t.summary, involves: t.involves }));
}
