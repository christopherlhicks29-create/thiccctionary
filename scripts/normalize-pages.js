#!/usr/bin/env node
/**
 * Wave 174: site-wide header + footer normalizer.
 *
 * For every <date>.html, articles/*.html, top-level *.html, etc.:
 *   1. Replace the <nav class="nav">...</nav> block with the canonical
 *      one, marking the link matching this page's URL as nav-link--active.
 *   2. Replace each footer column (Sections, Follow, Legal) with canonical
 *      content. Each column is anchored by its <p class="footer-head">XYZ</p>.
 *   3. Ensure <script defer src="/scripts/ccc-highlight.js?v=2"> is present
 *      before </body>. Strip any old inline highlightCcc function definitions.
 *
 * Pages skipped (intentionally don't have the main nav/footer):
 *   - admin/*
 *   - embed/* (these are iframe payloads)
 *   - og-image-generator.html, profile-image-generator.html (internal tools)
 *
 * Usage: node scripts/normalize-pages.js
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const CANON_NAV_LINKS = [
  { href: '/',                     text: "Today's Entry" },
  { href: '/archive.html',         text: 'The Archive' },
  { href: '/a-z.html',             text: 'A-Z' },
  { href: '/articles/',            text: 'Articles' },
  { href: '/about/documents/',     text: 'References' },
  { href: '/reels/',               text: 'Reels' },
  { href: '/cartoons/',            text: 'Cartoons' },
  { href: '/random.html',          text: 'Random' },
  { href: '/compare.html',         text: 'Compare' },
  { href: '/rate/',                text: 'Rate' },
  { href: '/api/',                 text: 'API' },
  { href: '/submit.html',          text: 'Submit a Thiccc' },
  { href: '/about/masthead/',      text: 'The Editors' },
  { href: '/about/',               text: 'About' },
];

const CANON_FOOTER_SECTIONS = `<p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/articles/">Articles</a>
      <a href="/about/documents/">References</a>
      <a href="/reels/">Reels</a>
      <a href="/cartoons/">Cartoons</a>
      <a href="/compare.html">Compare</a>
      <a href="/rate/">Rate</a>
      <a href="/submit.html">Submit</a>
      <a href="/embed/">Embed</a>
      <a href="/about/">About</a>
      <a href="https://buymeacoffee.com/Thiccctionary" target="_blank" rel="noopener">Tip jar</a>`;

const CANON_FOOTER_FOLLOW = `<p class="footer-head">Follow</p>
      <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X &middot; @thiccctionary</a>
      <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook &middot; /Thiccctionary</a>
      <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram &middot; @ogthiccctionary</a>
      <a href="https://www.tiktok.com/@thethiccctionary" target="_blank" rel="noopener">TikTok &middot; @thethiccctionary</a>
      <a href="/follow/">All handles &rarr;</a>`;

const CANON_FOOTER_LEGAL = `<p class="footer-head">Legal</p>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/press/">Press kit</a>
      <a href="mailto:admin@thiccctionary.com">Contact</a>`;

const CCC_SCRIPT_TAG = '<script defer src="/scripts/ccc-highlight.js?v=2"></script>';

const SKIP_PATTERNS = [
  /^admin\//,
  /^embed\/today\.html$/,
  // embed/index.html is the landing page about embedding; it gets the full
  // nav + footer like normal site pages. Only embed/<widget>.html (iframe
  // payloads) skip normalization.
  /^og-image-generator\.html$/,
  /^profile-image-generator\.html$/,
  /\.LATEST$/,
  /^entries\/_template\.html$/,
];

function isSkipped(rel) {
  return SKIP_PATTERNS.some(re => re.test(rel));
}

function normalizePath(p) {
  // Map physical paths to canonical URLs for matching the active link
  if (p === 'index.html') return '/';
  if (p === 'rate/index.html') return '/rate/';
  if (p === 'api/index.html') return '/api/';
  if (p === 'embed/index.html') return '/embed/';
  if (p === 'articles/index.html') return '/articles/';
  if (p === 'reels/index.html') return '/reels/';
  if (p === 'cartoons/index.html') return '/cartoons/';
  if (p === 'about/index.html') return '/about/';
  if (p === 'about/masthead/index.html') return '/about/masthead/';
  if (p === 'about/documents/index.html') return '/about/documents/';
  if (p === 'about/style-guide/index.html') return '/about/style-guide/';
  if (p === 'press/index.html') return '/press/';
  if (p === 'follow/index.html') return '/follow/';
  return '/' + p;
}

function buildNavHTML(filePath) {
  const myPath = normalizePath(filePath);
  const links = CANON_NAV_LINKS.map(({ href, text }) => {
    const isActive = href === myPath;
    const cls = isActive ? 'nav-link nav-link--active' : 'nav-link';
    return `    <a href="${href}" class="${cls}">${text}</a>`;
  }).join('\n');
  return `<nav class="nav">\n${links}\n  </nav>`;
}

function replaceNav(html, filePath) {
  return html.replace(/<nav class="nav">[\s\S]*?<\/nav>/, buildNavHTML(filePath));
}

function replaceFooterColumn(html, head, canonHTML) {
  // Replace from <p class="footer-head">{head}</p> up to the next </div>
  const escHead = head.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(
    `<p class="footer-head">${escHead}</p>[\\s\\S]*?(?=</div>)`,
    ''
  );
  return html.replace(re, canonHTML + '\n    ');
}

function ensureCccScript(html) {
  if (html.includes('/scripts/ccc-highlight.js')) return html;
  // Wave 174-fix: PURELY ADDITIVE. Do NOT strip inline highlighter blocks
  // because the homepage's inline script bundles the highlighter with the
  // hydration logic + share-button handlers - stripping deletes all of it
  // and breaks the homepage. The external script + any inline duplicate
  // are both safe (the highlighter's own skip-list prevents double-wrap).
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${CCC_SCRIPT_TAG}\n</body>`);
  }
  return html;
}

function* walkHtml(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (['node_modules', '.git', '.github'].includes(item.name)) continue;
      yield* walkHtml(full);
    } else if (item.name.endsWith('.html') && !item.name.endsWith('.LATEST')) {
      yield full;
    }
  }
}

let touched = 0, skipped = 0, errors = 0;
for (const abs of walkHtml(ROOT)) {
  const rel = path.relative(ROOT, abs);
  if (isSkipped(rel)) { skipped++; continue; }
  try {
    const before = fs.readFileSync(abs, 'utf8');
    let html = before;
    html = replaceNav(html, rel);
    if (html.includes('class="footer-head">Sections')) {
      html = replaceFooterColumn(html, 'Sections', CANON_FOOTER_SECTIONS);
    }
    if (html.includes('class="footer-head">Follow')) {
      html = replaceFooterColumn(html, 'Follow', CANON_FOOTER_FOLLOW);
    }
    if (html.includes('class="footer-head">Legal')) {
      html = replaceFooterColumn(html, 'Legal', CANON_FOOTER_LEGAL);
    }
    html = ensureCccScript(html);
    if (html !== before) {
      fs.writeFileSync(abs, html);
      touched++;
    }
  } catch (e) {
    console.error(`FAIL ${rel}: ${e.message}`);
    errors++;
  }
}
console.log(`[normalize] touched=${touched} skipped=${skipped} errors=${errors}`);
