/**
 * Wave 304: give every page an <h1> that describes THAT page.
 *
 * The problem
 * -----------
 * Every one of the 303 HTML pages on this site shipped the same <h1>: the
 * masthead wordmark, "The Thiccctionary". The actual subject of the page --
 * the headword, the article headline, "The Complete Archive" -- was an <h2>
 * sitting underneath it.
 *
 * The <h1> is one of the few remaining strong on-page topic signals. Spending
 * it on the brand name on all 303 pages means we spend it on nothing: every
 * page claims to be about the same thing, and the one string that would tell a
 * crawler what an entry page is actually about is demoted a level.
 *
 * The fix
 * -------
 *   - The masthead wordmark becomes a <div class="wordmark">. Nothing in
 *     styles.css selects the h1 tag (verified: zero bare `h1` selectors), so
 *     this is visually a no-op. aria-label and the home link are preserved.
 *   - The first <h2> on the page -- which on every template family is the
 *     topic heading (.headword, .article-headline, .section-title, ...) --
 *     is promoted to <h1>.
 *   - The root homepage is EXEMPT. There the brand name genuinely is the
 *     subject of the page, and its first <h2> is the featured word of the day,
 *     which would make the homepage's <h1> change every morning and point at
 *     content that the entry page already owns.
 *
 * Rather than patch the six generators that emit this markup and watch them
 * drift apart again, this runs as a build step over the whole tree and is
 * idempotent: a second pass reports zero changes.
 *
 * Usage: node scripts/fix-heading-hierarchy.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Directories that are not published pages.
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts', 'admin', 'api', 'v']);

// Pages where the wordmark is the correct <h1>: the site's own front door.
const EXEMPT = new Set(['index.html']);

async function walk(dir, out = []) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      await walk(full, out);
    } else if (d.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Returns the rewritten HTML, or null if nothing to do.
 * Headings cannot nest, so the first closing tag after the opener is the match.
 */
export function fixHeadings(html) {
  // Locate the wordmark <h1>...</h1>. Headings cannot nest, so the first
  // closing tag after the opener is the match.
  const wm = html.match(/<h1(\s[^>]*class="[^"]*\bwordmark\b[^"]*"[^>]*)>/i);
  if (!wm) return null;
  const wmOpenEnd = wm.index + wm[0].length;
  const wmClose = html.indexOf('</h1>', wmOpenEnd);
  if (wmClose === -1) return null;
  const wmEnd = wmClose + '</h1>'.length;

  // Only demote if there is a topic heading to promote in its place. A page
  // with no <h2> (e.g. a bare landing page) keeps the wordmark as its <h1>:
  // a brand-name <h1> is a weak signal, but no <h1> at all is a worse one.
  const rest = html.slice(wmEnd);
  const h2 = rest.match(/<h2(\s[^>]*)?>/i);
  if (!h2) return null;
  const h2Start = wmEnd + h2.index;
  const h2OpenEnd = h2Start + h2[0].length;
  const h2Close = html.indexOf('</h2>', h2OpenEnd);
  if (h2Close === -1) return null;

  // Never manufacture a second <h1>: bail if one already exists outside the
  // masthead.
  const others = html.slice(0, wm.index) + html.slice(wmEnd);
  if (/<h1[\s>]/i.test(others)) return null;

  return html.slice(0, wm.index) +
    `<div${wm[1]}>` + html.slice(wmOpenEnd, wmClose) + '</div>' +
    html.slice(wmEnd, h2Start) +
    `<h1${h2[1] || ''}>` + html.slice(h2OpenEnd, h2Close) + '</h1>' +
    html.slice(h2Close + '</h2>'.length);
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await walk(ROOT);
  const touched = [];
  const skipped = [];

  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (EXEMPT.has(rel)) continue;
    const html = await fs.readFile(f, 'utf8');
    if (!/<h1(\s[^>]*class="[^"]*\bwordmark\b)/i.test(html)) continue;
    const fixed = fixHeadings(html);
    if (!fixed) { skipped.push(rel); continue; }
    if (!check) await fs.writeFile(f, fixed, 'utf8');
    touched.push(rel);
  }

  for (const f of skipped) console.log(`[headings] left alone (no <h2> to promote): ${f}`);

  if (!touched.length) {
    console.log(`[headings] ${files.length} files, all already correct.`);
    return;
  }
  console.log(`[headings] ${check ? 'would fix' : 'fixed'} ${touched.length} file(s)`);
  for (const f of touched.slice(0, 15)) console.log(`  ~ ${f}`);
  if (touched.length > 15) console.log(`  ... and ${touched.length - 15} more`);
  if (check) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('fix-heading-hierarchy.js')) {
  await main();
}
