#!/usr/bin/env node
/**
 * sync-og-dimensions.js - Wave 311
 *
 * Every page declares an og:image. 43 of them declared no og:image:width or
 * og:image:height, which is the difference between a link preview that renders
 * as a full-bleed card and one that renders as a thumbnail while the crawler
 * goes and fetches the image to find out how big it is. Facebook's own docs are
 * explicit that the first scrape shows nothing without the dimensions.
 *
 * The tempting fix is to paste width=1200 height=630 into every generator. That
 * is the Wave 307 / Wave 308 mistake: a fact stored in two places drifts, and
 * the day someone ships a 1600x900 card the tags quietly start lying. So this
 * reads the actual bytes of the actual image and writes what it finds. It also
 * corrects tags that already exist and disagree with the file, which is the
 * failure mode hand-typed dimensions produce.
 *
 * Idempotent: a second run over a tree it just fixed changes nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ogDims, SITE } from './lib/image-size.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts', 'admin',
  'audits', 'outreach', 'tiktok-ready', 'dist', 'build']);

const sizeOf = (url) => ogDims(url, ROOT);

function walkHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walkHtml(p, out);
    } else if (name.endsWith('.html') && !name.endsWith('.LATEST')) {
      out.push(p);
    }
  }
  return out;
}

const OG_IMAGE = /<meta\s+property="og:image"\s+content="([^"]+)"\s*\/?>/;
const OG_W = /\n?[ \t]*<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/?>/g;
const OG_H = /\n?[ \t]*<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/g;

let fixed = 0, already = 0, unresolved = [];

for (const file of walkHtml(ROOT)) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(OG_IMAGE);
  if (!m) continue;

  const url = m[1];
  if (!url.startsWith(SITE)) { unresolved.push([file, `off-site og:image ${url}`]); continue; }
  const local = path.join(ROOT, url.slice(SITE.length).replace(/^\//, '').split('?')[0]);
  const size = sizeOf(url);
  if (!size) { unresolved.push([file, `could not size ${path.relative(ROOT, local)}`]); continue; }

  const want = `${m[0]}\n<meta property="og:image:width" content="${size.w}" />`
             + `\n<meta property="og:image:height" content="${size.h}" />`;
  // Drop whatever width/height tags exist, then re-emit from the file's bytes.
  const next = html.replace(OG_W, '').replace(OG_H, '').replace(m[0], want);
  if (next === html) { already++; continue; }
  fs.writeFileSync(file, next);
  fixed++;
}

if (unresolved.length) {
  console.log(`[og-dim] ${unresolved.length} page(s) whose og:image could not be measured:`);
  for (const [f, why] of unresolved.slice(0, 10)) console.log(`  ${path.relative(ROOT, f)}: ${why}`);
}
console.log(fixed === 0
  ? `[og-dim] ${already} page(s), all already correct.`
  : `[og-dim] ${fixed} page(s) updated, ${already} already correct.`);
