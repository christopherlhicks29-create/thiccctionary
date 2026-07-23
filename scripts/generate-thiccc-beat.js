#!/usr/bin/env node
/**
 * The Thiccc Beat, news-desk columns.
 *
 * Unlike the LLM-generative columns (mailbag, from-the-boat), Thiccc Beat
 * columns are authored as markdown drafts in drafts/thiccc-beat/*.md, each
 * with YAML frontmatter (author, role, lane, subject, ruling, source, date)
 * and a body that ends in a "ruling." This script renders every draft to a
 * proper article page (masthead + nav + footer + mobile-nav + schema), runs
 * the canon auto-linker, and registers it in data/articles.json.
 *
 * Deterministic: no API key needed. Safe to run repeatedly (idempotent by slug).
 *
 * Cadence: manual / sentinel for now. Future: a news-sourcing step writes new
 * drafts, then this renders them.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoLink } from './auto-link-references.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRAFTS_DIR = path.join(ROOT, 'drafts', 'thiccc-beat');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// House style: no em-dashes (pre-ship rule + From-the-Boat precedent). Convert to commas.
function deDash(s) { return String(s).replace(/\s*—\s*/g, ', '); }

// Inline markdown: bold, italic, links. Escapes first, then injects tags.
function inline(s) {
  let t = escapeHtml(deDash(s));
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, url) => `<a href="${escapeHtml(url)}">${txt}</a>`);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return t;
}

function parseDraft(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2].trim() };
}

// Body markdown to HTML. Handles: # title (becomes the headline, returned
// separately), the bold intro line, the byline, paragraphs, the ruling
// paragraph (kept as a callout), and the closing italic "filed" line.
function renderBody(body) {
  const lines = body.split('\n');
  let headline = '';
  const out = [];
  for (let raw of lines) {
    const ln = raw.trim();
    if (ln === '') continue;
    if (/^# /.test(ln)) { headline = deDash(ln.slice(2)); continue; }
    if (/^By /.test(ln)) { out.push(`<p class="beat-byline">${inline(ln)}</p>`); continue; }
    // Ruling line: starts with **The ruling
    if (/^\*\*The ruling/i.test(ln)) { out.push(`<p class="beat-ruling">${inline(ln)}</p>`); continue; }
    // Whole-line italic (e.g. THE THICCC BEAT kicker, or the closing filed line)
    if (/^\*[^*].*\*$/.test(ln) && !/\*\*/.test(ln)) { out.push(`<p class="beat-kicker"><em>${inline(ln.slice(1, -1))}</em></p>`); continue; }
    out.push(`<p>${inline(ln)}</p>`);
  }
  return { headline, html: out.join('\n') };
}

function buildPage({ meta, headline, bodyHtml, slug }) {
  // Wave 247: keep title <=70 and meta description <=165 (site-health SEO limits).
  // Append the ", The Thiccc Beat" suffix only when it still fits; truncate at a
  // word boundary rather than mid-word.
  const clamp = (str, max) => str.length <= max ? str : str.slice(0, max).replace(/\s+\S*$/, '');
  const titleSuffix = ', The Thiccc Beat';
  const title = (headline + titleSuffix).length <= 70 ? headline + titleSuffix : clamp(headline, 70);
  const desc = clamp(deDash(`${meta.author} on ${meta.subject}. Ruling: ${meta.ruling}. The Thiccc Beat, the desk reacts to the news.`), 165);
  const ogImg = `https://thiccctionary.com/articles/og/${slug}.png`;
  const url = `https://thiccctionary.com/articles/${slug}.html`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: deDash(headline),
    datePublished: meta.date,
    author: { '@type': 'Person', name: meta.author },
    publisher: { '@type': 'Organization', name: 'The Thiccctionary' },
    mainEntityOfPage: url,
  };
  const sourceLink = meta.source ? `<p class="beat-source">Source: <a href="${escapeHtml(meta.source)}" target="_blank" rel="noopener">${escapeHtml(meta.source.replace(/^https?:\/\//, '').slice(0, 60))}</a></p>` : '';

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta property="og:title" content="${escapeHtml(deDash(headline))}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:image" content="${ogImg}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.min.css?v=73" />
<link rel="icon" type="image/svg+xml" href="../favicon.svg" />
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>
<header class="masthead">
  <div class="masthead-top">
    <span class="meta-line">Vol. I &nbsp;&middot;&nbsp; Iss. <span id="issue-number">040</span> &nbsp;&middot;&nbsp; <span id="today-date">Friday, May 30, 2026</span></span>
    <span class="meta-line meta-line--right">Est. MMXXVI &nbsp;&middot;&nbsp; A Daily Reference</span>
  </div>
  <h1 class="wordmark" aria-label="Thiccctionary">
    <a href="/" class="wordmark-link" aria-label="Thiccctionary, home">
      <span class="wordmark-the">The</span>
      <span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
    </a>
  </h1>
  <nav class="nav">
    <a href="/" class="nav-link">Today's Entry</a>
    <a href="/archive.html" class="nav-link">The Archive</a>
    <a href="/a-z.html" class="nav-link">A-Z</a>
    <a href="/articles/" class="nav-link nav-link--active">Articles</a>
    <a href="/about/documents/" class="nav-link">References</a>
    <a href="/cartoons/" class="nav-link">Cartoons</a>
    <a href="/random.html" class="nav-link">Random</a>
    <a href="/compare.html" class="nav-link">Compare</a>
    <a href="/rate/" class="nav-link">Rate</a>
    <a href="/guess/" class="nav-link">Guess</a>
    <a href="/api/" class="nav-link">API</a>
    <a href="/submit.html" class="nav-link">Submit a Thiccc</a>
    <a href="/about/masthead/" class="nav-link">The Editors</a>
    <a href="/about/" class="nav-link">About</a>
  </nav>
</header>
<main id="main-content">
<article class="entry entry--single">
<div class="article-prose" style="max-width: 720px; margin: 2rem auto; padding: 0 16px; line-height: 1.8;">
<p class="article-meta"><a href="./">&larr; All articles</a> &middot; The Thiccc Beat &middot; ${escapeHtml(meta.date || '')}</p>
<h2 class="article-headline">${escapeHtml(deDash(headline))}</h2>
<p class="beat-deck"><strong>${escapeHtml(meta.author)}</strong>, ${escapeHtml(meta.role || '')} &middot; <em>${escapeHtml(meta.lane || '')}</em></p>
${bodyHtml}
${sourceLink}
</div>
</article>
</main>
<footer class="footer">
  <div class="footer-grid">
    <div>
      <p class="footer-wordmark">Thiccctionary<span style="font-size:0.55em; vertical-align:super; margin-left:2px; opacity:0.7;">TM</span></p>
      <p class="footer-tag">Documenting girth, since 2026.</p>
    </div>
    <div>
      <p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/articles/">Articles</a>
      <a href="/about/documents/">References</a>
      <a href="/cartoons/">Cartoons</a>
      <a href="/compare.html">Compare</a>
      <a href="/rate/">Rate</a>
      <a href="/submit.html">Submit</a>
      <a href="/embed/">Embed</a>
      <a href="/about/">About</a>
      <a href="https://buymeacoffee.com/Thiccctionary" target="_blank" rel="noopener">Tip jar</a>
    </div>
    <div>
      <p class="footer-head">Follow</p>
      <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X &middot; @thiccctionary</a>
      <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook &middot; /Thiccctionary</a>
      <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram &middot; @ogthiccctionary</a>
      <a href="https://www.tiktok.com/@thethiccctionary" target="_blank" rel="noopener">TikTok &middot; @thethiccctionary</a>
      <a href="/follow/">All handles &rarr;</a>
    </div>
    <div>
      <p class="footer-head">Legal</p>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/press/">Press kit</a>
      <a href="mailto:admin@thiccctionary.com">Contact</a>
    </div>
  </div>
  <p class="copyright">&copy; <span id="year">2026</span> Thiccctionary<sup style="font-size:0.7em;">TM</sup>. All entries fictional. All rulings final.</p>
</footer>
<script defer src="/scripts/ccc-highlight.js?v=2"></script>
<script defer src="/scripts/mobile-nav.js?v=66"></script>
<script defer src="/scripts/masthead-date.js?v=2"></script>
</body>
</html>
`;
  return autoLink(html);
}

async function main() {
  let files = [];
  try { files = (await fs.readdir(DRAFTS_DIR)).filter(f => f.endsWith('.md')); }
  catch { console.log('No drafts/thiccc-beat/ dir; nothing to render.'); return; }
  if (files.length === 0) { console.log('No Thiccc Beat drafts to render.'); return; }

  const articlesJsonPath = path.join(ROOT, 'data', 'articles.json');
  let articles = [];
  try { articles = JSON.parse(await fs.readFile(articlesJsonPath, 'utf8')); } catch {}

  const rendered = [];
  for (const file of files.sort()) {
    const raw = await fs.readFile(path.join(DRAFTS_DIR, file), 'utf8');
    const { meta, body } = parseDraft(raw);
    const { headline, html: bodyHtml } = renderBody(body);
    const base = file.replace(/\.md$/, '');
    const slug = `thiccc-beat-${base}`;
    const page = buildPage({ meta, headline, bodyHtml, slug });
    await fs.writeFile(path.join(ROOT, 'articles', `${slug}.html`), page, 'utf8');
    console.log(`Wrote articles/${slug}.html  (${headline})`);

    const entry = {
      slug,
      title: `${headline}`,
      description: deDash(`The Thiccc Beat: ${meta.author} on ${meta.subject}. Ruling: ${meta.ruling}.`),
      date: meta.date || base.slice(0, 10),
      author: meta.author,
      type: 'thiccc-beat',
    };
    articles = articles.filter(a => a.slug !== slug);
    articles.unshift(entry);
    rendered.push(slug);
  }

  articles.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  await fs.writeFile(articlesJsonPath, JSON.stringify(articles, null, 2) + '\n');
  console.log(`[thiccc-beat] rendered ${rendered.length} column(s); articles.json updated.`);

  // Wave 277: the homepage editorial-desk rail (index.html) and articles/index.html
  // are rendered from articles.json by regenerate-article-listings.js. That step was
  // easy to forget on manual runs (rail went stale 06-28 -> 07-04), so run it here.
  const { spawnSync } = await import('node:child_process');
  const regen = spawnSync(process.execPath, [path.join(__dirname, 'regenerate-article-listings.js')], { stdio: 'inherit' });
  if (regen.status !== 0) console.warn('[thiccc-beat] regenerate-article-listings failed; homepage rail may be stale.');
}

main().catch(e => { console.error(e); process.exit(1); });
