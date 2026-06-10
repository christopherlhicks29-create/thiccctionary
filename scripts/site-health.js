/**
 * Site health audit, runs in CI weekly via .github/workflows/site-health.yml.
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
import { validateEntry } from './banned-words.js';

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
    // relative, resolve against fromFile's directory
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
    bannedWordsInEntries: [],
    brokenAnchors: [],
    longTitles: [],
    longDescriptions: [],
    multipleH1: [],
    bannedWordsInArticles: [],
    missingOgImageFiles: [],
    missingWebp: [],
    navMissingMobileToggle: [],
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

    // Mobile-nav hamburger guard (Wave 238 bug class): any public page
    // with <nav class="nav"> must load scripts/mobile-nav.js or the
    // hamburger never renders on mobile. Exclude admin/ (no public nav).
    if (/<nav\s+class=["']nav["']/.test(content)
        && !content.includes('mobile-nav.js')
        && !rel.startsWith('admin/')) {
      issues.navMissingMobileToggle.push({ from: rel });
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

      // 4a. Verify the og:image file actually exists on disk (Wave 59)
      const ogImgMatch = content.match(/<meta[^>]*property=("og:image"|'og:image')[^>]*content=("([^"]+)"|'([^']+)')/);
      if (ogImgMatch) {
        const ogUrl = ogImgMatch[3] || ogImgMatch[4];
        if (ogUrl && ogUrl.startsWith('https://thiccctionary.com/')) {
          const ogLocal = path.join(ROOT, ogUrl.replace('https://thiccctionary.com/', ''));
          if (!(await fileExists(ogLocal))) {
            issues.missingOgImageFiles.push({ from: rel, ogImage: ogUrl });
          }
        }
      }
    }

    // 4b. Broken same-page anchors, links to #foo where foo isn't an id on this page
    const ids = new Set();
    for (const m of content.matchAll(/id=("([^"]+)"|'([^']+)')/g)) ids.add(m[2] || m[3]);
    for (const m of content.matchAll(/<a[^>]*href=("#([^"]+)"|'#([^']+)')/g)) {
      const tgt = m[2] || m[3];
      if (!tgt || tgt === 'top') continue;
      if (!ids.has(tgt)) {
        issues.brokenAnchors.push({ from: rel, anchor: tgt });
      }
    }

    // 4c. Title length (Google truncates at ~60 chars on desktop)
    const titleMatch = content.match(/<title>([^<]*)<\/title>/);
    if (titleMatch && titleMatch[1].length > 70) {
      issues.longTitles.push({ from: rel, length: titleMatch[1].length, title: titleMatch[1] });
    }

    // 4d. Meta description length (Google truncates at ~160 chars)
    const descTagMatch = content.match(/<meta[^>]*name=("description"|'description')[^>]*>/);
    if (descTagMatch) {
      const tag = descTagMatch[0];
      const contentMatch = tag.match(/content=("([^"]*)"|'([^']*)')/);
      if (contentMatch) {
        const desc = contentMatch[2] !== undefined ? contentMatch[2] : contentMatch[3];
        if (desc.length > 170) {
          issues.longDescriptions.push({ from: rel, length: desc.length });
        }
      }
    }

    // 4e. Multiple <h1> per page (semantically should be exactly one)
    const h1Count = (content.match(/<h1[\s>]/g) || []).length;
    if (h1Count > 1) {
      issues.multipleH1.push({ from: rel, count: h1Count });
    }
  }

  // 6. Banned-words check on every entry (Wave 45, continuous QA)
  try {
    const entriesPath = path.join(ROOT, 'data', 'entries.json');
    if (await fileExists(entriesPath)) {
      const entries = JSON.parse(await fs.readFile(entriesPath, 'utf-8'));
      for (const e of entries) {
        const r = validateEntry(e);
        if (!r.ok) {
          for (const v of r.violations) {
            issues.bannedWordsInEntries.push({ date: e.date, word: e.word, field: v.field, term: v.term, kind: v.kind });
          }
        }
      }
    }
  } catch (e) {
    console.warn(`Banned-words check failed: ${e.message}`);
  }

  // 6b. Banned-words check on articles (Wave 54, extends Wave 45)
  const articleFiles = htmlFiles.filter(f => path.relative(ROOT, f).startsWith('articles/') && !path.relative(ROOT, f).endsWith('index.html'));
  for (const f of articleFiles) {
    const rel = path.relative(ROOT, f);
    const c = await fs.readFile(f, 'utf-8');
    // Strip <script>, <style>, <head>; just check article body text
    const stripped = c.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<head[\s\S]*?<\/head>/g,'').replace(/<[^>]+>/g,' ');
    // Use the validateEntry helper indirectly, wrap article text as if it were an entry
    const fakeEntry = { definitions: [stripped], example:'', etymology:'', caption:'', word:'' };
    const r = validateEntry(fakeEntry);
    if (!r.ok) {
      for (const v of r.violations) {
        issues.bannedWordsInArticles.push({ from: rel, term: v.term, kind: v.kind });
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


  // Wave 230j: missing .webp coverage. Browsers using <picture><source srcset=".webp">
  // 404 the webp and (in some CF Pages edge cases) the whole picture element fails to
  // render even though the .jpg fallback exists. Catch any entry whose .jpg exists
  // but its sibling .webp does not.
  try {
    const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data/entries.json'), 'utf-8'));
    for (const e of entries) {
      const img = e.image || '';
      if (!img.endsWith('.jpg')) continue;
      const jpgPath = path.join(ROOT, img);
      const webpPath = jpgPath.replace(/\.jpg$/, '.webp');
      const fsSync = await import('node:fs');
      if (fsSync.existsSync(jpgPath) && !fsSync.existsSync(webpPath)) {
        issues.missingWebp.push({ date: e.date, word: e.word, jpg: img, webp: img.replace(/\.jpg$/, '.webp') });
      }
    }
  } catch (err) {
    // entries.json missing or unreadable, skip
  }

  return { issues, stats };
}

function formatReport({ issues, stats }) {
  const lines = [];
  const dateStr = new Date().toISOString().slice(0, 10);
  const totalIssues = issues.brokenLinks.length + issues.missingAlt.length + issues.badSchema.length
                      + issues.missingOg.length + issues.sitemapDrift.inSitemapNotInRepo.length
                      + issues.sitemapDrift.inRepoNotInSitemap.length + issues.missingWebp.length + issues.navMissingMobileToggle.length;
  lines.push(`# Site Health Audit, ${dateStr}`);
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
    i => `\`${i.from}\`, img src=\`${i.src}\``);
  section(`Invalid JSON-LD schema (${issues.badSchema.length})`, issues.badSchema,
    i => `\`${i.from}\`, ${i.error}`);
  section(`Entry/article pages missing OG tags (${issues.missingOg.length})`, issues.missingOg,
    i => `\`${i.from}\`, missing: ${i.missing.join(', ')}`);
  section(`Sitemap: URLs that don't resolve (${issues.sitemapDrift.inSitemapNotInRepo.length})`, issues.sitemapDrift.inSitemapNotInRepo,
    i => `${i.url} (expected file: \`${i.expected}\`)`);
  section(`Sitemap: pages in repo NOT in sitemap (${issues.sitemapDrift.inRepoNotInSitemap.length})`, issues.sitemapDrift.inRepoNotInSitemap,
    i => `\`${i.file}\`, expected URL: ${i.expectedUrl}`);

  section(`Banned-word violations in entries.json (${issues.bannedWordsInEntries.length})`, issues.bannedWordsInEntries,
    i => `\`${i.date}\` (${i.word}), [${i.field}] "${i.term}"`);

  section(`Broken same-page anchors (${issues.brokenAnchors.length})`, issues.brokenAnchors,
    i => `\`${i.from}\` → \`#${i.anchor}\` (no element with this id on the page)`);

  section(`Page titles >70 chars (${issues.longTitles.length})`, issues.longTitles,
    i => `\`${i.from}\`, ${i.length} chars`);

  section(`Meta descriptions >170 chars (${issues.longDescriptions.length})`, issues.longDescriptions,
    i => `\`${i.from}\`, ${i.length} chars`);

  section(`Pages with multiple <h1> (${issues.multipleH1.length})`, issues.multipleH1,
    i => `\`${i.from}\`, ${i.count} h1 tags`);

  section(`Banned-word violations in articles (${issues.bannedWordsInArticles.length})`, issues.bannedWordsInArticles,
    i => `\`${i.from}\`, "${i.term}"`);

  section(`Missing og:image files (${issues.missingOgImageFiles.length})`, issues.missingOgImageFiles,
    i => `\`${i.from}\` → ${i.ogImage} (file does not exist on disk)`);

  section(`Missing .webp pair for entry images (${issues.missingWebp.length})`, issues.missingWebp,
    i => `\`${i.date}\` (${i.word}): \`${i.jpg}\` exists but \`${i.webp}\` is missing. Browsers may show alt text instead of image.`);

  section(`Pages missing mobile-nav hamburger (${issues.navMissingMobileToggle.length})`, issues.navMissingMobileToggle,
    i => `\`${i.from}\`: has <nav class="nav"> but does not load mobile-nav.js (hamburger will not show on mobile).`);

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
