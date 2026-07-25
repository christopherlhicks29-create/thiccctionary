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
 * An override short-circuits the ladder entirely: if a human named the subject,
 * guessing past it is not help.
 */
export function queryLadder(word, override = '') {
  const ov = clean(override);
  if (ov) return [ov];

  const out = [];
  const push = (q) => {
    const c = clean(q);
    if (c && c.length > 1 && !out.includes(c)) out.push(c);
  };

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
