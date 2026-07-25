#!/usr/bin/env node
/**
 * Wave 204: visual smoke test. Static scan over rendered HTML on disk to
 * catch the bug classes that bit us today (footer invisibility, double-
 * quote rendering, dangling <img src>). Fast, no network, no browser.
 *
 * Run: node scripts/smoke-test-visual.js
 * Exit 1 on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const failures = [];

function fail(file, rule, msg) {
  failures.push({ file, rule, msg });
  console.log(`  FAIL [${rule}] ${file}: ${msg}`);
}

function walkHtml(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // Wave 311: 'prints' came off this list. It holds one public page that is
      // in the sitemap, and skipping it meant the smoke test never once looked
      // at a file that had been serving 4,320 NUL bytes since the day it was
      // created. Same lesson as sync-footer-links' SKIP_DIRS in Wave 308: a
      // directory belongs here only if it contains no page a reader can reach.
      if (['.git','node_modules','audits','outreach','tiktok-ready','dist','build','.github'].includes(name)) continue;
      out.push(...walkHtml(p));
    } else if (name.endsWith('.html') && !name.endsWith('.LATEST')) {
      out.push(p);
    }
  }
  return out;
}

// ----- Rule 1: rendered double-quote pattern -----
// Look for sequences like "“  ...  ”" (curly inside straight) or
// "“ ... ”"  (straight outside curly) in body content of class="example".
function checkDoubleQuotes(file, html) {
  const exampleRe = /<p class="example">([^<]*)<\/p>/g;
  let m;
  while ((m = exampleRe.exec(html)) !== null) {
    const inner = m[1];
    // Bad pattern: starts with "( or ") and immediately has another quote
    if (/^["“”]["“”]/.test(inner) || /["“”]["“”]$/.test(inner)) {
      fail(file, 'double-quote', `<.example> renders with adjacent quote chars: ${JSON.stringify(inner.slice(0,40))}...`);
    }
  }
}

// ----- Rule 2: every <img src> resolves to a file on disk -----
function checkImages(file, html) {
  const imgRe = /<img[^>]+src=["']([^"']+)["']/g;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    let src = m[1];
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
    if (src.startsWith('//')) continue;
    // Skip template placeholders (e.g. {{IMAGE}}, ${expr}, dynamic JS)
    if (/[{$]/.test(src)) continue;
    // Wave 229b: strip query string + hash fragment for filesystem lookup.
    // Cache-busting via ?v=N is valid HTML; the file on disk doesn't have the suffix.
    src = src.split('?')[0].split('#')[0];
    if (!src) continue;
    // Resolve relative path
    const baseDir = path.dirname(file);
    let resolved;
    if (src.startsWith('/')) {
      resolved = path.join(ROOT, src);
    } else {
      resolved = path.resolve(baseDir, src);
    }
    if (!fs.existsSync(resolved)) {
      fail(file, 'img-missing', `<img src="${src}"> not found on disk (looked at ${resolved.replace(ROOT,'.')})`);
    } else {
      const sz = fs.statSync(resolved).size;
      if (sz < 2048) {
        fail(file, 'img-tiny', `<img src="${src}"> exists but is only ${sz}B (suspicious)`);
      }
    }
  }
}

// ----- Rule 3: footer-text invisible pattern -----
// If a file uses class="copyright" (or any footer text class), make sure
// styles.css doesn't set its color to the same family as the page bg.
let styleCache = null;
function getStylesheet() {
  if (styleCache !== null) return styleCache;
  try {
    styleCache = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  } catch {
    styleCache = '';
  }
  return styleCache;
}

// Wave 311: prints/index.html was born with 4,320 NUL bytes glued to the end
// of a perfectly valid document, and served them to every visitor for its whole
// life. Nothing caught it because every check here reads the file as UTF-8 and
// then looks at the markup -- and the markup was fine. A byte-level check is
// the only one that sees this, so it has to be its own check.
function checkBytes(file) {
  const buf = fs.readFileSync(file);
  const nul = buf.indexOf(0);
  if (nul !== -1) {
    const count = buf.reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
    fail(file, 'nul-bytes',
      `contains ${count} NUL byte(s), first at offset ${nul}. The file is ` +
      `corrupt past that point; strip the padding and re-check whatever wrote it.`);
  }
  // A UTF-8 BOM ahead of <!DOCTYPE breaks some crawlers' doctype sniffing.
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    fail(file, 'bom', 'starts with a UTF-8 BOM; strip it.');
  }
}

function checkFooterVisibility(file, html) {
  if (!html.includes('class="copyright"')) return;
  const css = getStylesheet();
  // Extract the .copyright block
  const m = css.match(/\.copyright\s*\{([^}]+)\}/);
  if (!m) {
    fail(file, 'footer-no-css', `references class="copyright" but styles.css has no .copyright rule`);
    return;
  }
  const block = m[1];
  // Look for color: rgba/hex matching the cream paper family.
  // Cream paper = rgb(244, 236, 220) (the body bg). Any color in that family
  // with high alpha against a cream bg = invisible.
  const colorM = block.match(/color\s*:\s*([^;]+)/);
  if (!colorM) return;
  const colorVal = colorM[1].trim().toLowerCase();
  // Bad: rgba(244, 236, 220, ...) or #f4ecdc-ish
  if (/rgba?\s*\(\s*24[34],\s*23[56],\s*22[01]/.test(colorVal)) {
    fail(file, 'footer-invisible', `.copyright color is "${colorVal}", cream-on-cream invisible on light-bg pages`);
  }
}

// ----- Run -----
console.log('[smoke] scanning HTML files...');
const files = walkHtml(ROOT);
console.log(`[smoke] checking ${files.length} HTML files`);
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  checkBytes(f);
  checkDoubleQuotes(f, html);
  checkImages(f, html);
  checkFooterVisibility(f, html);
}

if (failures.length === 0) {
  console.log(`[smoke] all checks passed.`);
  process.exit(0);
} else {
  console.log(`\n[smoke] ${failures.length} failure(s).`);
  process.exit(1);
}
