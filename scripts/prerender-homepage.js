#!/usr/bin/env node
/**
 * Wave 179: prerender today's entry into index.html.
 *
 * The homepage was static (Thiccc Boeing placeholder) + JS hydration from
 * data/entries.json. Panel review flagged this as a UX flash + CLS hit.
 * This script bakes today's entry into the HTML directly so the first
 * paint already shows the correct content.
 *
 * Substitutes by element ID:
 *   #featured-image       img / link
 *   #featured-caption     caption text
 *   #featured-credit      photographer credit
 *   #featured-word        headword
 *   #featured-pronunciation pronunciation + part of speech
 *   #featured-def-1, #featured-def-2  definitions
 *   #featured-example     example
 *   #featured-etymology   etymology
 *   #featured-tags        tag spans
 *   #issue-number         entries count (zero-padded)
 *
 * The hydration script remains - it just becomes a no-op for content
 * already in the DOM, and it'll still pick up updates if entries.json
 * changes between build and visit (rare, but harmless).
 *
 * Usage: node scripts/prerender-homepage.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const ENTRIES = path.join(ROOT, 'data', 'entries.json');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Replace the inner content of an element with id=<id>.
// Anchors on `id="<id>"`, finds the opening tag, finds its closing tag, replaces between.
function replaceById(html, id, newInner) {
  // Depth-aware: find opening <tag id="..."> then walk forward counting
  // <tag> / </tag> until depth returns to 0. Avoids the non-greedy regex
  // bug where the match stops at the first </anything> inside (caused
  // a-z.html duplicate-content bug in Wave 182's first attempt).
  const openRe = new RegExp(`<([a-z0-9]+)\\s+[^>]*id="${id}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return html;
  const tag = m[1].toLowerCase();
  const afterOpen = m.index + m[0].length;
  const sameTagRe = new RegExp(`<(/?)${tag}(\\s|>)`, 'gi');
  sameTagRe.lastIndex = afterOpen;
  let depth = 1, closeIdx = -1, scan;
  while ((scan = sameTagRe.exec(html)) !== null) {
    if (scan[1] === '/') {
      depth--;
      if (depth === 0) { closeIdx = scan.index; break; }
    } else { depth++; }
  }
  if (closeIdx < 0) return html;
  const closeEnd = html.indexOf('>', closeIdx) + 1;
  return html.slice(0, afterOpen) + newInner + html.slice(closeIdx, closeEnd) + html.slice(closeEnd);
}

async function main() {
  const html = await fs.readFile(INDEX, 'utf8');
  const entries = JSON.parse(await fs.readFile(ENTRIES, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error('[prerender] entries.json empty - nothing to do');
    process.exit(0);
  }
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const f = sorted[0];
  console.log(`[prerender] featuring ${f.date} - ${f.word}`);

  let out = html;

  // featured-image (wrap img in link to entry permalink). Use <picture>
  // with WebP source + JPEG fallback (Wave 183).
  if (f.image) {
    const slug = f.date;
    const webp = String(f.image).replace(/\.jpg$/i, '.webp');
    const imgHTML = `<a href="entries/${slug}.html"><picture><source srcset="${esc(webp)}" type="image/webp" /><img src="${esc(f.image)}" alt="${esc(f.word)}" /></picture></a>`;
    out = replaceById(out, 'featured-image', imgHTML);
  }

  // caption + credit
  out = replaceById(out, 'featured-caption', esc(f.caption || ''));
  if (f.photographer) {
    const url = esc((f.photographerUrl || 'https://unsplash.com/') + '?utm_source=thiccctionary&utm_medium=referral');
    const credit = `Photo by <a href="${url}" target="_blank" rel="noopener">${esc(f.photographer)}</a> on <a href="https://unsplash.com/?utm_source=thiccctionary&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>`;
    out = replaceById(out, 'featured-credit', credit);
  } else {
    out = replaceById(out, 'featured-credit', '');
  }

  // headword + pronunciation
  out = replaceById(out, 'featured-word', esc(f.word));
  const pron = `${esc(f.pronunciation || '')} &nbsp;<em>${esc(f.partOfSpeech || 'n.')}</em>`;
  out = replaceById(out, 'featured-pronunciation', pron);

  // definitions
  out = replaceById(out, 'featured-def-1', `<strong>1.</strong> ${f.definitions?.[0] || ''}`);
  if (f.definitions?.[1]) {
    out = replaceById(out, 'featured-def-2', `<strong>2.</strong> ${f.definitions[1]}`);
  } else {
    out = replaceById(out, 'featured-def-2', '');
  }

  // example
  out = replaceById(out, 'featured-example', esc(f.example || ''));

  // etymology
  out = replaceById(out, 'featured-etymology', f.etymology || '');

  // tags
  const tagsHTML = (f.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('\n          ');
  out = replaceById(out, 'featured-tags', tagsHTML);

  // issue number (entry count, zero-padded)
  out = replaceById(out, 'issue-number', String(entries.length).padStart(3, '0'));

  // Wave 291: masthead date. Was frozen at the hand-written May 1 static text
  // forever (JS masked it for browsers; crawlers and no-JS saw a stale paper).
  const dateText = new Date(f.date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  out = replaceById(out, 'today-date', esc(dateText));

  // Wave 291: Recently Catalogued rail. Mirrors the client-side card markup in
  // index.html exactly (entries 1..8 after the featured entry).
  const cardHTML = sorted.slice(1, 9).map(e => {
    const snip = String(e.definitions?.[0] || '').replace(/<[^>]+>/g, '').slice(0, 70);
    const d = new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `<a class="recent-card" href="entries/${esc(e.date)}.html">
        <div class="recent-thumb" style="background-image: url('${esc(e.image)}'); background-size: cover; background-position: center;"></div>
        <div class="recent-meta">
          <span class="recent-date">${d}</span>
          <h4 class="recent-word">${esc(e.word)}</h4>
          <p class="recent-snip">${esc(snip)}\u2026</p>
        </div>
      </a>`;
  }).join('\n      ');
  out = replaceById(out, 'recents-grid', '\n      ' + cardHTML + '\n    ');
  // The rail was hidden at opacity:0 until JS populated it - with fresh
  // prerendered cards there is nothing to hide from no-JS readers.
  out = out.replace('id="recents-grid" style="opacity:0', 'id="recents-grid" style="opacity:1');

  await fs.writeFile(INDEX, out, 'utf8');
  console.log(`[prerender] index.html updated, ${out.length} bytes`);
}

main().catch(e => { console.error('[prerender] FATAL:', e); process.exit(1); });
