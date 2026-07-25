/**
 * Wave 303: normalize the <head> of every page in articles/.
 *
 * Why this exists
 * ---------------
 * Articles are produced by four different generators (generate-thiccc-beat.js,
 * generate-mailbag.js, generate-from-the-boat.js, generate-weekly-article.js)
 * plus a handful of hand-written files. Their head templates drifted: the 34
 * Beat/Mailbag/Boat pages shipped with NO canonical tag, no og:type,
 * no og:site_name/locale, no twitter:title/description/image, no manifest,
 * no RSS alternate, and a stale stylesheet version -- while the rest of the
 * site had all of it.
 *
 * Rather than patch four templates and wait for them to drift again, this
 * runs as a build step over the whole directory and is idempotent: it only
 * inserts what is missing. Fix it here once and every generator inherits it.
 *
 * Also repairs meta descriptions that were truncated mid-word by the
 * generators (they hard-sliced at a character budget), trimming instead at
 * the last sentence boundary and falling back to the last word boundary.
 *
 * Usage: node scripts/normalize-article-heads.js [--check]
 *   --check  report what would change and exit 1 if anything would, without
 *            writing. Intended for CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES = path.join(ROOT, 'articles');
const BASE = 'https://thiccctionary.com';
const CSS_VERSION = '73';
const CHECK_ONLY = process.argv.includes('--check');

const decode = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const encode = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const attr = (html, re) => { const m = html.match(re); return m ? m[1] : null; };

// The generators sliced descriptions at a raw character budget, producing
// endings like "...weighed at 1,278.8 kg (2,819 lb 4 oz) at the". Trim back to
// the last sentence, or failing that the last word, and mark elision.
// Run tidyOnce to a fixed point: one pass can leave a newly-exposed dangling
// word at the end, which would make the --check mode report drift forever.
function tidyDescription(raw) {
  let d = decode(raw), prev;
  do { prev = d; d = tidyOnce(d); } while (d !== prev);
  return d;
}

function tidyOnce(raw) {
  let d = decode(raw).replace(/\s+/g, ' ').trim();
  if (!d) return d;
  d = d.replace(/[\s….]+$/, '');
  // Already ends cleanly on a sentence? leave it.
  const lastStop = Math.max(d.lastIndexOf('. '), d.lastIndexOf('? '), d.lastIndexOf('! '));
  const DANGLING = /\b(the|a|an|of|at|in|on|to|and|or|for|with|by|from|as|that|which|was|were|is|are|its|it|his|her|their)$/i;
  if (DANGLING.test(d)) {
    if (lastStop > 60) {
      d = d.slice(0, lastStop + 1);
    } else {
      // Drop trailing dangling function words one at a time.
      while (DANGLING.test(d)) d = d.slice(0, d.lastIndexOf(' ')).replace(/[\s,;:]+$/, '');
      d += '…';
    }
  } else if (!/[.!?…"']$/.test(d)) {
    d += '.';
  }
  return d;
}

function ensure(html, marker, block, anchorRe) {
  if (html.includes(marker)) return html;
  const m = html.match(anchorRe);
  if (!m) return html;
  return html.replace(m[0], m[0] + '\n' + block);
}

async function normalizeFile(file) {
  const rel = `articles/${file}`;
  const full = path.join(ARTICLES, file);
  let html = await fs.readFile(full, 'utf8');
  const before = html;
  const changes = [];

  const url = `${BASE}/articles/${file}`;
  const title = decode(attr(html, /<title>([^<]*)<\/title>/) || '');
  const ogTitle = decode(attr(html, /property="og:title" content="([^"]*)"/) || title);
  const desc = attr(html, /name="description" content="([^"]*)"/) || '';
  const ogImage = attr(html, /property="og:image" content="([^"]*)"/) || '';

  // --- meta description: repair mid-word truncation --------------------------
  if (desc) {
    const tidied = tidyDescription(desc);
    const encoded = encode(tidied);
    if (encoded !== desc) {
      html = html.split(`content="${desc}"`).join(`content="${encoded}"`);
      changes.push('description');
    }
  }

  // --- canonical (the big one; 34 files had none) ----------------------------
  if (!/rel="canonical"/.test(html)) {
    html = ensure(html, 'rel="canonical"',
      `<link rel="canonical" href="${url}" />`,
      /<meta name="viewport"[^>]*>|<title>[^<]*<\/title>/);
    changes.push('canonical');
  }

  // --- Open Graph completeness ----------------------------------------------
  const anchorOg = /<meta property="og:title"[^>]*>/;
  if (!/property="og:type"/.test(html)) {
    html = ensure(html, 'og:type', `<meta property="og:type" content="article" />`, anchorOg);
    changes.push('og:type');
  }
  if (!/property="og:site_name"/.test(html)) {
    html = ensure(html, 'og:site_name',
      `<meta property="og:site_name" content="Thiccctionary" />\n<meta property="og:locale" content="en_US" />`,
      anchorOg);
    changes.push('og:site_name');
  }

  // --- Twitter card: card type was set but title/description/image were not,
  //     so summary_large_image had nothing to render. -------------------------
  if (/name="twitter:card"/.test(html) && !/name="twitter:title"/.test(html)) {
    const d = decode(attr(html, /name="description" content="([^"]*)"/) || '');
    const tw = [
      `<meta name="twitter:title" content="${encode(ogTitle)}" />`,
      `<meta name="twitter:description" content="${encode(d)}" />`,
      ogImage ? `<meta name="twitter:image" content="${ogImage}" />` : null,
    ].filter(Boolean).join('\n');
    html = ensure(html, 'twitter:title', tw, /<meta name="twitter:card"[^>]*>/);
    changes.push('twitter');
  }

  // --- PWA + feed discovery, present sitewide except here --------------------
  if (!/rel="manifest"/.test(html)) {
    html = ensure(html, 'rel="manifest"',
      `<link rel="manifest" href="/manifest.webmanifest" />\n` +
      `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />\n` +
      `<meta name="theme-color" content="#f5e8c7" />`,
      /<link rel="icon"[^>]*>/);
    changes.push('manifest');
  }
  if (!/type="application\/rss\+xml"/.test(html)) {
    html = ensure(html, 'application/rss+xml',
      `<link rel="alternate" type="application/rss+xml" title="Thiccctionary RSS Feed" href="${BASE}/feed.xml" />`,
      /<link rel="icon"[^>]*>/);
    changes.push('rss');
  }

  // --- stylesheet cache-bust drift ------------------------------------------
  if (/styles\.min\.css\?v=(?!73\b)\d+/.test(html)) {
    html = html.replace(/styles\.min\.css\?v=\d+/g, `styles.min.css?v=${CSS_VERSION}`);
    changes.push('css-version');
  }

  if (html === before) return null;
  if (!CHECK_ONLY) await fs.writeFile(full, html, 'utf8');
  return { file: rel, changes };
}

async function main() {
  const files = (await fs.readdir(ARTICLES)).filter(f => f.endsWith('.html'));
  const changed = [];
  for (const f of files) {
    const r = await normalizeFile(f);
    if (r) changed.push(r);
  }
  if (changed.length === 0) {
    console.log(`[article-heads] ${files.length} files, all already normalized.`);
    return;
  }
  const tally = {};
  for (const c of changed) for (const k of c.changes) tally[k] = (tally[k] || 0) + 1;
  console.log(`[article-heads] ${CHECK_ONLY ? 'would update' : 'updated'} ${changed.length}/${files.length} files:`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  if (CHECK_ONLY) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
