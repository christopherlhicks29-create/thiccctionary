/**
 * Wave 304b: make sure every page's footer links to the sections that exist.
 *
 * The footer "Sections" column is copy-pasted into six generators. When a new
 * hub ships -- /category/ is the current example -- the only pages that link to
 * it are the ones it generated itself, so a crawler that lands anywhere else on
 * the site has no path to it. Ten pages linking to a hub is not a hub.
 *
 * Rather than edit six generators and watch them drift, this reconciles the
 * footer across the whole tree after generation, the same way
 * fix-heading-hierarchy.js does. It is idempotent: it only inserts a link that
 * is absent from the page entirely, so a second pass reports zero changes.
 *
 * Usage: node scripts/sync-footer-links.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts', 'admin', 'api', 'v']);

/**
 * Each rule inserts `link` immediately after `after` in the footer, but only if
 * `href` appears nowhere on the page.
 */
const RULES = [
  {
    href: '/category/',
    after: '<a href="/a-z.html">A-Z</a>',
    link: '<a href="/category/">Categories</a>',
  },
];

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

export function syncFooter(html) {
  let out = html;
  for (const r of RULES) {
    if (out.includes(`href="${r.href}"`)) continue;
    const i = out.indexOf(r.after);
    if (i === -1) continue;
    const end = i + r.after.length;
    // Preserve the indentation of the anchor we are inserting after.
    const lineStart = out.lastIndexOf('\n', i) + 1;
    const indent = out.slice(lineStart, i).match(/^\s*/)[0];
    out = out.slice(0, end) + '\n' + indent + r.link + out.slice(end);
  }
  return out === html ? null : out;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await walk(ROOT);
  const touched = [];

  for (const f of files) {
    const html = await fs.readFile(f, 'utf8');
    const fixed = syncFooter(html);
    if (!fixed) continue;
    if (!check) await fs.writeFile(f, fixed, 'utf8');
    touched.push(path.relative(ROOT, f));
  }

  if (!touched.length) {
    console.log(`[footer] ${files.length} files, all already correct.`);
    return;
  }
  console.log(`[footer] ${check ? 'would fix' : 'fixed'} ${touched.length} file(s)`);
  for (const f of touched.slice(0, 10)) console.log(`  ~ ${f}`);
  if (touched.length > 10) console.log(`  ... and ${touched.length - 10} more`);
  if (check) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('sync-footer-links.js')) {
  await main();
}
