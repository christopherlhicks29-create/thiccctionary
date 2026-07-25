/**
 * plate.js - the one place that knows what an entry's plate number is.
 *
 * Every entry caption opens with an archival plate number, the way a Victorian
 * illustrated dictionary would. The number is not a fact anyone should type: it
 * is the entry's chronological position, which the data already knows.
 *
 * It was typed anyway. The generation prompt asks the model to write the string
 * "Plate N." and leave N alone for a later step to substitute. Wave 307 added
 * that step to generate-daily.js, but only there, and only for new entries -- so
 * regenerate-text.js still emits the placeholder unsubstituted, the 76 entries
 * written before Wave 307 still carry it, and the roman-numeral converter now
 * exists in three files with three sets of comments explaining itself.
 *
 * That is this repo's recurring bug in its purest form: a fact stored in more
 * than one place drifts. So the number lives here, derived, and everything else
 * asks. sync-plate-numbers.js is the reconciler that makes stored captions agree
 * with what this file says they should be.
 */

const VALS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'],
  [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function toRomanNumeral(num) {
  let n = Math.max(0, Math.floor(num)), out = '';
  for (const [v, sym] of VALS) { while (n >= v) { out += sym; n -= v; } }
  return out;
}

/**
 * 1-based chronological position. entries.json is stored newest-first, but that
 * is a storage detail and not something to rely on: sort by date and look the
 * entry up, so a file that arrives out of order still numbers correctly.
 * Returns null when the entry is not in the list.
 */
export function plateNumberFor(entry, entries) {
  if (!Array.isArray(entries) || !entry || !entry.date) return null;
  const dates = entries.map(e => e && e.date).filter(Boolean).sort();
  const i = dates.indexOf(entry.date);
  return i === -1 ? null : i + 1;
}

// Any short token, not just roman numerals: real values on disk include
// "Plate IV.", "Plate 12." and "Plate N.". Trailing comma optional, because
// some captions were hand-written with a full stop and no comma.
export const PLATE_PREFIX = /^Plate\s+[^.]{1,10}\.,?\s*/i;

/** The caption with its plate prefix replaced by the number it should carry. */
export function withPlateNumber(caption, num) {
  if (typeof caption !== 'string' || !num) return caption;
  const body = caption.replace(PLATE_PREFIX, '');
  return `Plate ${toRomanNumeral(num)}., ${body}`;
}

/** The caption without its plate prefix, for alt text and card descriptions. */
export function stripPlatePrefix(caption) {
  return typeof caption === 'string' ? caption.replace(PLATE_PREFIX, '') : caption;
}
