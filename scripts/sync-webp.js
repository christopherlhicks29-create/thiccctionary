/**
 * Wave 305: never ship a <picture> whose <source> points at a file that
 * isn't there.
 *
 * The bug this exists to prevent
 * ------------------------------
 * regen-on-push.yml regenerated the 2026-07-25 entry image, wrote
 * images/2026-07-25-loaf-meatloaf-4l9c.jpg, and called jpg-to-webp.js. That
 * workflow (unlike daily.yml and regenerate-entry.yml) never installed
 * libwebp, so the conversion failed. The caller logged
 * "WebP regen failed (non-fatal)" and carried on. The generators then emitted
 *
 *   <picture>
 *     <source srcset="images/2026-07-25-loaf-meatloaf-4l9c.webp" type="image/webp">
 *     <img src="images/2026-07-25-loaf-meatloaf-4l9c.jpg" ...>
 *   </picture>
 *
 * and it auto-merged. A browser that supports WebP -- which is all of them --
 * commits to the <source> and does NOT fall back to the <img> when it 404s.
 * The homepage hero and the entry page rendered a broken image on the day the
 * entry went out, and the weekly health audit was the thing that noticed.
 *
 * Two independent guards now, because "remember to install libwebp in every
 * new workflow" is not a guard:
 *   1. jpg-to-webp.js gained a Python/Pillow fallback, so conversion has to
 *      lose three times before it fails.
 *   2. This reconciler. For every WebP a page references, either the file is
 *      made to exist or the <source> is removed so the <img> renders. A
 *      missing derivative costs us the bandwidth saving; it must never cost us
 *      the picture.
 *
 * Idempotent by construction: after one pass every referenced WebP exists, or
 * the reference is gone.
 *
 * Usage: node scripts/sync-webp.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts']);

// <source ...> is void, so there is no closing tag to find: the element runs
// from "<source" to the first ">" that is not inside an attribute value. The
// attributes here are always double-quoted, so [^>]* is safe.
const SOURCE_RE = /<source\b[^>]*>/gi;

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

async function exists(abs) {
  try { await fs.access(abs); return true; } catch { return false; }
}

/**
 * Resolve a URL as written in a page back to a path on disk.
 * Root-absolute ("/images/x.webp") resolves against ROOT; anything else
 * resolves against the directory of the page that referenced it.
 * Returns null for off-site URLs, which we do not own and must not touch.
 */
function resolveRef(url, pageDir) {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return null;
  const clean = url.split('?')[0].split('#')[0];
  if (!clean) return null;
  return clean.startsWith('/')
    ? path.join(ROOT, clean.slice(1))
    : path.resolve(pageDir, clean);
}

/** Every candidate URL in a srcset, descriptors ("2x", "800w") stripped. */
function srcsetUrls(srcset) {
  return srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
}

/**
 * Make `abs` exist by converting its sibling JPEG. Returns true on success.
 * Failure is expected and handled (the caller strips the <source>), so this
 * never throws.
 */
function tryConvert(abs) {
  for (const ext of ['.jpg', '.jpeg', '.JPG', '.JPEG']) {
    const src = abs.replace(/\.webp$/i, ext);
    try {
      // Capture rather than inherit: three of these four attempts normally
      // fail with "no such JPEG", and printing that to a CI log makes a
      // working run look broken. Only a success gets to say anything.
      const out = execFileSync('node', [path.join(__dirname, 'jpg-to-webp.js'), src], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (out.trim()) console.log(out.trim());
      return true;
    } catch {
      // Wrong extension, or no converter available. Try the next candidate.
    }
  }
  return false;
}

async function processFile(file, { check }) {
  const html = await fs.readFile(file, 'utf8');
  const pageDir = path.dirname(file);
  const notes = [];

  const cuts = [];   // [start, end) ranges of <source> tags to delete
  let m;
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(html)) !== null) {
    const tag = m[0];
    const attr = tag.match(/\bsrcset="([^"]*)"/i);
    if (!attr) continue;

    const urls = srcsetUrls(attr[1]);
    if (!urls.some(u => /\.webp$/i.test(u.split('?')[0]))) continue;

    // A <source> is usable if ANY of its candidates resolves. Only strip when
    // every one of them is missing and unrecoverable.
    let usable = false;
    for (const url of urls) {
      const abs = resolveRef(url, pageDir);
      if (abs === null) { usable = true; break; }        // off-site: not ours
      if (await exists(abs)) { usable = true; continue; }
      if (!check && tryConvert(abs)) {
        usable = true;
        notes.push(`generated ${path.relative(ROOT, abs)}`);
        continue;
      }
      if (check) {
        // Report the honest outcome without writing: a sibling JPEG means the
        // real run would generate rather than strip.
        const jpg = await exists(abs.replace(/\.webp$/i, '.jpg'));
        notes.push(`${jpg ? 'would generate' : 'would strip <source> for'} ${path.relative(ROOT, abs)}`);
        usable = true;   // do not also report a strip for the same tag
      }
    }

    if (!usable) {
      // Swallow the newline the tag sits on, so removing it does not leave a
      // blank line behind in the <picture>.
      let start = m.index;
      let end = m.index + tag.length;
      const lineStart = html.lastIndexOf('\n', start);
      if (lineStart !== -1 && html.slice(lineStart + 1, start).trim() === '') start = lineStart;
      cuts.push([start, end]);
      notes.push(`stripped <source> ${attr[1]} (no file, no JPEG to convert)`);
    }
  }

  if (!cuts.length) return notes;

  let out = '';
  let cursor = 0;
  for (const [start, end] of cuts) {
    out += html.slice(cursor, start);
    cursor = end;
  }
  out += html.slice(cursor);
  if (!check) await fs.writeFile(file, out, 'utf8');
  return notes;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await walk(ROOT);
  let touched = 0;
  const lines = [];

  for (const f of files) {
    const notes = await processFile(f, { check });
    if (!notes.length) continue;
    touched++;
    for (const n of notes) lines.push(`  ~ ${path.relative(ROOT, f)}: ${n}`);
  }

  if (!touched) {
    console.log(`[webp-sync] ${files.length} files, every <source> resolves.`);
    return;
  }
  console.log(`[webp-sync] ${check ? 'would fix' : 'fixed'} ${touched} file(s)`);
  for (const l of lines.slice(0, 20)) console.log(l);
  if (lines.length > 20) console.log(`  ... and ${lines.length - 20} more`);
  if (check) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('sync-webp.js')) {
  await main();
}
