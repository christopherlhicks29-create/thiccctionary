/**
 * Site health audit — runs in CI weekly via .github/workflows/site-health.yml.
 *
 * Checks the entire repo for:
 *   - Broken internal links (relative or absolute thiccctionary.com URLs that don't resolve)
 *   - Images without alt text
 *   - Invalid JSON-LD schema blocks
 *   - Entry/article pages missing required OG tags
 *   - Sitemap drift (URLs in sitemap that don't exist; pages that exist but aren't in sitemap)
 *
 * Output: audits/health-YYYY-MM-DD.md (created if any issues found, or to record clean run)
 *
 * Usage:
 *   node scripts/site-health.js              # run audit, write report
 *   node scripts/site-health.js --check      # exit 1 if issues found (CI gate)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://thiccctionary.com';

const CHECK_MODE = process.argv.includes('--check');

async function walkHtml(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.git')) continue;
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkHtml(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function urlToLocalPath(href, fromFile) {
  // Returns the absolute local repo path the URL would resolve to, or null if external/non-checkable.
  if (!href) return null;
  href = href.split('#')[0].split('?')[0]; // strip fragment + query
  if (!href) return null;
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
  if (href.startsWith('//')) return null; // protocol-relative external
  let p;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    if (!href.startsWith(SITE)) return null; // external, skip live check
    p = href.slice(SITE.length);
  } else if (href.startsWith('/')) {
    p = href;
  } else {
    // relative — resolve against fromFile's directory
    const fromDir = path.dirname(fromFile);
    p = path.relative(ROOT, path.resolve(fromDir, href));
    if (p.startsWith('..')) return null; // escapes repo
    return path.join(ROOT, p);
  }
  // p is now site-relative
  if (p.endsWith('/')) p = p + 'index.html';
  if (!path.extname(p)) {
    // could be a directory served as /foo/ → try /foo/index.html
    const tryIndex = path.join(ROOT, p, 'index.html');
    return tryIndex;
  }
  return path.join(ROOT, p);
}

async function audit() {
  const issues = {
    brokenLinks: [],
    missingAlt: [],
    badSchema: [],
    missingOg: [],
    sitemapDrift: { inSitemapNotInRepo: [], inRepoNotInSitemap: [] },
  };
  let stats = { filesScanned: 0, linksChecked: 0, imagesChecked: 0, schemaBlocks: 0 };

  const htmlFiles = await walkHtml(ROOT);

  // Scan each HTML file
  for (const file of htmlFiles) {
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('.git/') || rel.endsWith('.LATEST')) continue;
    stats.filesScanned++;
    const content = await fs.readFile(file, 'utf-8');

    // 1. Broken internal links
    const linkRe = /<a\s+[^>]*href=["']([^"']+)["']/gi;
    let m;
    while ((m = linkRe.exec(content)) !== null) {
      stats.linksChecked++;
      const href = m[1];
      // Skip JS template literals (e.g. `${slug}`) and obvious tokens
      if (href.includes('${') || href.includes('{{')) continue;
      const localPath = urlToLocalPath(href, file);
      if (localPath && !(await fileExists(localPath))) {
        issues.brokenLinks.push({ from: rel, href, expected: path.relative(ROOT, localPath) });
      }
    }

    // 2. Images without alt
    const imgRe = /<img\s+([^>]+)>/gi;
    while ((m = imgRe.exec(content)) !== null) {
      stats.imagesChecked++;
      const attrs = m[1];
      const hasSrc = /src=["']([^"']+)["']/.exec(attrs);
      const hasAlt = /\salt=["']/.test(attrs);
      if (hasSrc && !hasAlt) {
        issues.missingAlt.push({ from: rel, src: hasSrc[1] });
      }
    }

    // 3. Invalid JSON-LD schema (skip template files with placeholder tokens)
    const schemaRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const isTemplateFile = rel.includes('_template') || /[\$\{]\w+[,\}]/.test(content.slice(0, 5000));
    while ((m = schemaRe.exec(content)) !== null) {
      if (isTemplateFile) { stats.schemaBlocks++; continue; }
      stats.schemaBlocks++;
      const json = m[1].trim();
      try { JSON.parse(json); }
      catch (e) {
        issues.badSchema.push({ from: rel, error: e.message.slice(0, 100) });
      }
    }

    // 4. Entry/article pages missing OG tags
    const isEntry = rel.startsWith('entries/') && rel.endsWith('.html') && !rel.includes('_template');
    const isArticle = rel.startsWith('articles/') && rel.endsWith('.html') && rel !== 'articles/index.html';
    if (isEntry || isArticle) {
      const requiredOg = ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'];
      const missing = requiredOg.filter(tag => !content.includes(`property="${tag}"`) && !content.includes(`name="${tag}"`));
      if (missing.length > 0) {
        issues.missingOg.push({ from: rel, missing });
      }
    }
  }

  // 5. Sitemap drift
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  if (await fileExists(sitemapPath)) {
    const sitemap = await fs.readFile(sitemapPath, 'utf-8');
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    for (const url of sitemapUrls) {
      const localPath = urlToLocalPath(url, sitemapPath);
      if (localPath && !(await fileExists(localPath))) {
        issues.sitemapDrift.inSitemapNotInRepo.push({ url, expected: path.relative(ROOT, localPath) });
      }
    }
    // Check for entry pages NOT in sitemap
    const entryFiles = htmlFiles.filter(f => path.relative(ROOT, f).startsWith('entries/') && !f.includes('_template'));
    for (const ef of entryFiles) {
      const expectedUrl = `${SITE}/${path.relative(ROOT, ef).replace(/\\/g, '/')}`;
      if (!sitemapUrls.includes(expectedUrl)) {
        issues.sitemapDrift.inRepoNotInSitemap.push({ file: path.relative(ROOT, ef), expectedUrl });
      }
    }
  }

  return { issues, stats };
}

function formatReport({ issues, stats }) {
  const lines = [];
  const dateStr = new Date().toISOString().slice(0, 10);
  const totalIssues = issues.brokenLinks.length + issues.missingAlt.length + issues.badSchema.length
                      + issues.missingOg.length + issues.sitemapDrift.inSitemapNotInRepo.length
                      + issues.sitemapDrift.inRepoNotInSitemap.length;
  lines.push(`# Site Health Audit — ${dateStr}`);
  lines.push('');
  lines.push(`**Status:** ${totalIssues === 0 ? '✅ Clean' : `⚠️ ${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`}`);
  lines.push('');
  lines.push(`**Scanned:** ${stats.filesScanned} HTML files, ${stats.linksChecked} links, ${stats.imagesChecked} images, ${stats.schemaBlocks} schema blocks.`);
  lines.push('');

  function section(title, items, formatter) {
    lines.push(`## ${title}`);
    lines.push('');
    if (items.length === 0) {
      lines.push('*None.*');
    } else {
      for (const it of items) lines.push(`- ${formatter(it)}`);
    }
    lines.push('');
  }

  section(`Broken internal links (${issues.brokenLinks.length})`, issues.brokenLinks,
    i => `\`${i.from}\` → \`${i.href}\` (expected: \`${i.expected}\`)`);
  section(`Images without alt text (${issues.missingAlt.length})`, issues.missingAlt,
    i => `\`${i.from}\` — img src=\`${i.src}\``);
  section(`Invalid JSON-LD schema (${issues.badSchema.length})`, issues.badSchema,
    i => `\`${i.from}\` — ${i.error}`);
  section(`Entry/article pages missing OG tags (${issues.missingOg.length})`, issues.missingOg,
    i => `\`${i.from}\` — missing: ${i.missing.join(', ')}`);
  section(`Sitemap: URLs that don't resolve (${issues.sitemapDrift.inSitemapNotInRepo.length})`, issues.sitemapDrift.inSitemapNotInRepo,
    i => `${i.url} (expected file: \`${i.expected}\`)`);
  section(`Sitemap: pages in repo NOT in sitemap (${issues.sitemapDrift.inRepoNotInSitemap.length})`, issues.sitemapDrift.inRepoNotInSitemap,
    i => `\`${i.file}\` — expected URL: ${i.expectedUrl}`);

  lines.push('---');
  lines.push('');
  lines.push('*Run by `scripts/site-health.js`. Triggered weekly via `.github/workflows/site-health.yml`. Open an issue or commit fixes for any items above.*');
  return lines.join('\n');
}

async function main() {
  const result = await audit();
  const report = formatReport(result);
  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(ROOT, 'audits', `health-${dateStr}.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log(report);
  console.log(`\nReport written to ${path.relative(ROOT, reportPath)}`);
  const totalIssues = Object.values(result.issues).reduce((acc, v) => {
    if (Array.isArray(v)) return acc + v.length;
    return acc + Object.values(v).reduce((a, x) => a + x.length, 0);
  }, 0);
  if (CHECK_MODE && totalIssues > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(2); });
