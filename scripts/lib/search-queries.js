/**
 * search-queries.js - turning a dictionary headword into something a stock
 * photo library can actually find.
 *
 * Headwords here are written in dictionary inversion: "Crankshaft, Marine
 * Diesel", "Atlas Stone, Strongman", "Frigidaire, Side-by-Side". That is the
 * correct form for an alphabetical archive and the wrong form for a search box.
 * Unsplash returned zero results for all three, and regenerate-images.js had
 * exactly one fallback -- strip the word "thiccc" -- which does nothing to a
 * headword that never contained it. So those entries could never be reshot, and
 * the run logged "no results" as though the library had nothing rather than as
 * though we had asked badly.
 *
 * The ladder below goes from most specific to most likely to return something,
 * all derived from the headword. Nothing here is a per-entry hand-written
 * query: SUBJECT_OVERRIDE remains the escape hatch for the cases where the
 * headword genuinely is not the subject.
 *
 * Wave 326. The override used to short-circuit the ladder to exactly one rung,
 * on the reasoning that "if a human named the subject, guessing past it is not
 * help." That reasoning cost a whole run: the 2026-07-25 Frigidaire reshoot was
 * fired with "stainless steel side by side refrigerator", Unsplash returned 0
 * photos for that exact phrase, and the run ended there -- one query, no
 * fallback, no candidates, nothing for the critic to judge.
 *
 * The reasoning was also written when the quality gate was weak. Before Wave 325
 * the gate re-read a percentage the model had volunteered, so a broad query that
 * surfaced a loosely-related photo could actually ship it, and keeping the query
 * narrow was doing part of the gate's job. The gate now measures prominence from
 * a bounding box in JS. That makes broadening safe: a wider query cannot ship a
 * worse photo, it can only hand the critic more candidates to reject. Query
 * breadth is a recall knob; the gate is the precision knob. They were tangled.
 */

const THICCC = /\bthicc+(c+|er|est)?\b/gi;

const clean = (s) => String(s || '').replace(THICCC, '').replace(/\s+/g, ' ').trim();

/**
 * Ordered, de-duplicated list of queries to try for a headword.
 *
 *   "Crankshaft, Marine Diesel" -> ["Crankshaft, Marine Diesel",
 *                                   "Marine Diesel Crankshaft",
 *                                   "Crankshaft"]
 *
 * An override goes in FRONT of that ladder rather than replacing it. The
 * operator's phrase is tried first because it is the best description we have;
 * the headword rungs stay behind it so a phrase stock photography has never
 * heard of degrades into something searchable instead of into zero results.
 *
 *   word "Frigidaire, Side-by-Side", override "stainless steel side by side
 *   refrigerator" -> ["stainless steel side by side refrigerator",
 *                     "Frigidaire, Side-by-Side",
 *                     "Side-by-Side Frigidaire",
 *                     "Frigidaire"]
 *
 * An override may also carry its own rungs, pipe-separated, for the cases where
 * the headword is no help at all and the operator knows the broader term:
 *
 *   "timpani orchestra|timpani|orchestral drum"
 *
 * Every rung is still just a query. Nothing here decides what ships.
 */
export function queryLadder(word, override = '') {
  const out = [];
  const push = (q) => {
    const c = clean(q);
    if (c && c.length > 1 && !out.includes(c)) out.push(c);
  };

  for (const rung of String(override || '').split('|')) push(rung);

  const raw = String(word || '').trim();
  push(raw);

  // De-invert: "Head, Qualifier" reads naturally as "Qualifier Head". This is
  // the one that usually works -- "Marine Diesel Crankshaft" is how a
  // photographer would have captioned it.
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    push([...parts.slice(1), parts[0]].join(' '));
    // Head noun alone. Broad, and the last resort before giving up: a generic
    // crankshaft photo still beats leaving the entry on a photo of something
    // else, which is the state these three entries were actually in.
    push(parts[0]);
  }

  return out;
}

/**
 * Walk the ladder and ACCUMULATE candidates rather than stopping at the first
 * rung that returns anything.
 *
 * Wave 328c. The caller used to break out of the ladder the moment a rung
 * returned a non-empty array. That treats "returned something" as "returned
 * something useful", and the Medicine Ball reshoot showed the difference: the
 * rung "vintage leather medicine ball" returned 6 photos, none of them a
 * medicine ball, and because 6 > 0 the run never tried "leather medicine ball",
 * which had returned 29 the firing before. A narrow rung that answers badly
 * starved the pool of a broad rung that answers well, purely by being first.
 *
 * This is the Wave 326 mistake one layer down. The ladder was built as a
 * zero-results fallback chain, so its exit condition asks about recall; but by
 * the time it is used, the question being asked of it is about precision, and
 * six wrong photographs are worth the same as none. Ladder order still means
 * preference -- earlier rungs enter the pool first and the picker sees them
 * first -- but a thin first rung no longer ends the search.
 *
 * Stops as soon as the pool reaches `minPool`, so the common case where rung
 * one returns a full page of 30 still costs exactly one API call.
 *
 * `search` is injected so this is testable without a network or a key.
 */
export async function gatherCandidates(ladder, search, opts = {}) {
  const minPool = typeof opts.minPool === 'number' ? opts.minPool : 15;
  const log = opts.log || (() => {});
  const candidates = [];
  const seen = new Set();
  const queriesUsed = [];

  for (const q of ladder) {
    const hits = (await search(q)) || [];
    log(`  Searched "${q}" -> ${hits.length} results.`);
    let added = 0;
    for (const h of hits) {
      if (!h) continue;
      // A candidate with no id cannot be de-duplicated, so keep it rather than
      // silently dropping it; the critic is the thing that decides, not this.
      if (h.id != null) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
      }
      candidates.push(h);
      added++;
    }
    if (added) queriesUsed.push(q);
    if (candidates.length >= minPool) break;
  }

  return { candidates, queriesUsed };
}
