#!/usr/bin/env node
/**
 * Wave 183: convert a JPEG to a sibling WebP (same path, .webp extension).
 *
 * Usage: node scripts/jpg-to-webp.js path/to/image.jpg [quality]
 *
 * Quality default: 82. Method: 6 (slowest, best compression).
 * Uses sharp if available, falls back to ImageMagick `convert`.
 *
 * Returns 0 on success, 1 on failure.
 */

import { execSync } from 'node:child_process';
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

// Prefer cwebp (libwebp). Falls back to ImageMagick.
function hasCmd(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

try {
  if (hasCmd('cwebp')) {
    execSync(`cwebp -q ${quality} -m 6 -mt -quiet "${src}" -o "${dst}"`, { stdio: 'inherit' });
  } else if (hasCmd('convert')) {
    execSync(`convert "${src}" -quality ${quality} -define webp:method=6 "${dst}"`, { stdio: 'inherit' });
  } else {
    console.error('Neither cwebp nor convert (ImageMagick) found. Install libwebp-tools or imagemagick.');
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
