/**
 * image-size.js - Wave 311
 *
 * One place that answers "how big is this image, actually."
 *
 * The og:image:width / og:image:height tags were hard-coded to 1200x630 in four
 * separate files. That number is right for the social card and wrong for every
 * entry photo, which are 1080x1140 -- so 221 pages spent their whole lives
 * telling Facebook and X that a portrait photograph was a landscape card, and
 * the platforms cropped accordingly. Hard-coding a measurement is how that
 * happens. Measuring it is how it stops.
 *
 * Header parsing only, no decode: PNG IHDR, GIF logical screen descriptor,
 * WebP VP8X canvas, JPEG start-of-frame.
 */
import fs from 'fs';
import path from 'path';

export const SITE = 'https://thiccctionary.com';

/** Intrinsic pixel size from a raw image buffer, or null if unreadable. */
export function imageSize(buf) {
  // PNG: 8-byte signature, then IHDR length/type, then w/h as big-endian u32.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF: logical screen descriptor, little-endian u16 pair at byte 6.
  if (buf.length > 10 && buf.slice(0, 3).toString('latin1') === 'GIF') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // WebP. Only the VP8X chunk carries a clean canvas size.
  if (buf.length > 30 && buf.slice(0, 4).toString('latin1') === 'RIFF'
      && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    if (buf.slice(12, 16).toString('latin1') === 'VP8X') {
      return {
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
    return null;
  }
  // JPEG: walk the marker chain to the first start-of-frame.
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xC0 && marker <= 0xCF
          && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const cache = new Map();

/**
 * Size of a site-absolute og:image URL by reading the file it points at.
 * Returns null for off-site URLs, unresolved template placeholders, and
 * anything whose header will not parse -- callers omit the tags in that case,
 * which is strictly better than emitting a guess.
 */
export function ogDims(url, root) {
  if (!url || !url.startsWith(SITE)) return null;
  const rel = url.slice(SITE.length).replace(/^\//, '').split('?')[0];
  const local = path.join(root, rel);
  if (cache.has(local)) return cache.get(local);
  let out = null;
  try { out = imageSize(fs.readFileSync(local)); } catch { out = null; }
  cache.set(local, out);
  return out;
}

/** The two meta tags for an og:image URL, or '' when it cannot be measured. */
export function ogDimsTags(url, root) {
  const d = ogDims(url, root);
  if (!d) return '';
  return `\n<meta property="og:image:width" content="${d.w}" />`
       + `\n<meta property="og:image:height" content="${d.h}" />`;
}
