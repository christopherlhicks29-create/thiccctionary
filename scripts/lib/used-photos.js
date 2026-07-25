/**
 * Wave 306: never give two entries the same photograph.
 *
 * The bug this exists to prevent
 * ------------------------------
 * The pipeline has had a subject dedup guard since Wave 257 (subjectFamilyDup),
 * so it will not publish "Concrete Mixer" twice. What it has never had is a
 * PHOTO dedup guard, and those are different failures. Three entries --
 *
 *   2026-05-21  Atlas Stone, Strongman
 *   2026-06-05  Cannonball, Naval
 *   2026-07-06  Ball, Medicine Gym
 *
 * -- are three distinct subjects that sail past the subject guard, and all
 * three shipped the SAME Unsplash photo (unsplash.com/photos/...TthLw9wNyQE,
 * "pile of round black balls"). Same for Teapot/Kettle and
 * Crankshaft/Generator. Seven entries, three photographs.
 *
 * This was survivable while an image only ever appeared one-per-page. Wave 304
 * shipped /category/ hubs, which put twenty thumbnails in a grid, and
 * /category/industrial-machinery/ now shows the same photo twice above the
 * fold. It reads as a broken site, not a coincidence.
 *
 * The fix is at SELECTION time, not audit time: Unsplash hands back 30
 * candidates per search, of which the catalog has consumed 105 photos total
 * across the site's whole history. Filtering the handful we have already used
 * costs nothing and makes the collision impossible rather than merely
 * detectable. site-health.js reports the class too, for photos that arrive by
 * some path other than these generators.
 */

/**
 * Unsplash photo IDs are the trailing slug segment of the share URL:
 *   https://unsplash.com/photos/black-teapot-on-wooden-surface-V8DRhQ8YoZs
 *                                                             ^^^^^^^^^^^
 * The descriptive prefix is generated from the photo's alt text and Unsplash
 * has changed it under stable IDs before, so match on the ID alone.
 */
export function photoId(unsplashUrl) {
  if (!unsplashUrl || typeof unsplashUrl !== 'string') return null;
  const seg = unsplashUrl.split('?')[0].replace(/\/+$/, '').split('/').pop();
  if (!seg) return null;
  const m = seg.match(/([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : seg;
}

/** Every Unsplash photo ID already spent by an entry in the catalog. */
export function usedPhotoIds(entries) {
  const out = new Set();
  for (const e of entries || []) {
    const id = photoId(e && e.unsplashUrl);
    if (id) out.add(id);
  }
  return out;
}

/**
 * Drop candidates whose photo the catalog already uses.
 *
 * Deliberately permissive on the empty case. A repeated photo is a blemish; a
 * day with no entry is a hole in the calendar, and the calendar-gap check in
 * site-health.js exists because those have hurt before. If every candidate is
 * spent -- which needs a search to return 30 photos we have all used, against
 * a catalog of ~105 -- take the collision and say so in the log rather than
 * starving the caller.
 *
 * @param {Array<{id?:string, unsplashUrl?:string}>} candidates
 * @param {Set<string>} used
 * @param {(msg:string)=>void} [log]
 */
export function filterUsedPhotos(candidates, used, log = console.log) {
  if (!Array.isArray(candidates) || !used || used.size === 0) return candidates;
  const fresh = candidates.filter(c => {
    const id = (c && c.id) || photoId(c && c.unsplashUrl);
    return !(id && used.has(id));
  });
  const dropped = candidates.length - fresh.length;
  if (dropped === 0) return candidates;
  if (fresh.length === 0) {
    log(`[photo-dedup] all ${candidates.length} candidates are already used by other entries; proceeding anyway rather than dropping the day.`);
    return candidates;
  }
  log(`[photo-dedup] dropped ${dropped} candidate(s) already used by another entry; ${fresh.length} left.`);
  return fresh;
}
