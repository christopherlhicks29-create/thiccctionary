#!/usr/bin/env node
/**
 * Wave 183: convert a JPEG to a sibling WebP (same path, .webp extension).
 *
 * Usage: node scripts/jpg-to-webp.js path/to/image.jpg [quality]
 *
 * Quality default: 82. Method: 6 (slowest, best compression).
 *
 * Wave 305: three converters, tried in order -- cwebp (libwebp), ImageMagick
 * `convert`, then Python Pillow. The third one is new and it is the whole
 * point of this change.
 *
 * Why: regen-on-push.yml never installed libwebp. It regenerated an entry
 * image, wrote images/2026-07-25-loaf-meatloaf-4l9c.jpg, called this script,
 * got "neither cwebp nor convert found", and the caller swallowed the failure
 * as non-fatal. The HTML still shipped
 * <source srcset="...-4l9c.webp"> pointing at a file that did not exist.
 * A browser does NOT fall back to the <img> when a <source> 404s, so the
 * homepage hero and the entry page rendered a broken image for a day.
 *
 * Pillow ships on most images that have python3 at all, so this failure mode
 * now needs all three to be missing. sync-webp.js is the belt to this braces:
 * if conversion is impossible it strips the <source> instead.
 *
 * Returns 0 on success, 1 on failure.
 */

import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const quality = parseInt(process.argv[3] || '82', 10);

if (!src || !fs.existsSync(src)) {
  console.error('Usage: jpg-to-webp.js <path/to/image.jpg> [quality]');
  process.exit(1);
}

const dst = src.replace(/\.jpe?g$/i, '.webp');
if (dst === src) {
  console.error('Source must have .jpg or .jpeg extension');
  process.exit(1);
}

// Prefer cwebp (libwebp). Falls back to ImageMagick, then to Python Pillow.
function hasCmd(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function hasPillow() {
  if (!hasCmd('python3')) return false;
  try { execSync('python3 -c "import PIL"', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

try {
  if (hasCmd('cwebp')) {
    execSync(`cwebp -q ${quality} -m 6 -mt -quiet "${src}" -o "${dst}"`, { stdio: 'inherit' });
  } else if (hasCmd('convert')) {
    execSync(`convert "${src}" -quality ${quality} -define webp:method=6 "${dst}"`, { stdio: 'inherit' });
  } else if (hasPillow()) {
    // Paths go in through argv, not string interpolation, so a filename
    // containing a quote cannot break out into the Python source. With
    // `python3 -c CODE a b c`, sys.argv is ['-c', 'a', 'b', 'c'].
    const py = [
      'import sys',
      'from PIL import Image',
      "Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'WEBP', quality=int(sys.argv[3]), method=6)",
    ].join('\n');
    execFileSync('python3', ['-c', py, src, dst, String(quality)], { stdio: 'inherit' });
  } else {
    console.error('No converter found: tried cwebp, ImageMagick convert, and Python Pillow.');
    process.exit(1);
  }
  const srcKB = (fs.statSync(src).size / 1024).toFixed(0);
  const dstKB = (fs.statSync(dst).size / 1024).toFixed(0);
  const savings = (100 * (1 - fs.statSync(dst).size / fs.statSync(src).size)).toFixed(0);
  console.log(`[webp] ${path.basename(src)}: ${srcKB}KB -> ${dstKB}KB (${savings}% smaller)`);
} catch (e) {
  console.error('[webp] FAIL:', e.message);
  process.exit(1);
}
