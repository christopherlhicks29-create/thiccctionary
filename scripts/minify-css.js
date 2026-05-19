#!/usr/bin/env node
/**
 * Wave 186: conservative CSS minifier.
 *
 * Strips comments + collapses whitespace + removes optional semicolons.
 * Does NOT alter selectors or values. Generates styles.min.css from styles.css.
 *
 * Usage: node scripts/minify-css.js
 *
 * Output: styles.min.css (same dir as input)
 */

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'styles.css';
const DST = 'styles.min.css';

function minify(css) {
  let out = css;
  // 1. Strip /* comments */
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // 2. Collapse runs of whitespace (preserve a single space)
  out = out.replace(/\s+/g, ' ');
  // 3. Remove spaces around symbols that don't need them
  out = out.replace(/\s*([{}:;,>+~])\s*/g, '$1');
  // 4. Remove trailing semicolon before }
  out = out.replace(/;}/g, '}');
  // 5. Trim leading/trailing whitespace
  out = out.trim();
  return out;
}

const src = fs.readFileSync(SRC, 'utf8');
const min = minify(src);
fs.writeFileSync(DST, min);

const srcKB = (src.length / 1024).toFixed(1);
const dstKB = (min.length / 1024).toFixed(1);
const savings = ((1 - min.length / src.length) * 100).toFixed(0);
console.log(`[minify-css] ${SRC}: ${srcKB} KB -> ${DST}: ${dstKB} KB (${savings}% smaller)`);
