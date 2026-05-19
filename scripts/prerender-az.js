#!/usr/bin/env node
/**
 * Wave 180: prerender /a-z.html from data/entries.json at build time.
 *
 * Was: client-side fetch + DOM build. Crawlers saw an empty shell.
 * Now: alphabetical index baked into the HTML. JS still runs as no-op
 * fallback in case entries.json updates after the page is cached.
 *
 * Substitutes:
 *   #az-counts     "N entries across M of 26 letters."
 *   #az-jumpbar    A-Z jump bar (active letters linkable, others greyed)
 *   #az-sections   <section> per letter with <ul> of entries
 *
 * Usage: node scripts/prerender-az.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceById(html, id, newInner) {
  const re = new RegExp(`(<[a-z0-9]+\\s+[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(</[a-z0-9]+>)`, 'i');
  return html.replace(re, (m, open, _old, close) => `${open}${newInner}${close}`);
}

async function main() {
  const html = await fs.readFile(path.join(ROOT, 'a-z.html'), 'utf8');
  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error('[prerender-az] entries empty');
    process.exit(0);
  }

  // Sort all entries alphabetically by word (case-insensitive)
  const sorted = [...entries].sort((a, b) =>
    String(a.word).localeCompare(String(b.word), 'en', { sensitivity: 'base' })
  );

  // Group by first letter
  const byLetter = {};
  for (const e of sorted) {
    const letter = String(e.word || '')[0]?.toUpperCase();
    if (!letter || !/[A-Z]/.test(letter)) continue;
    if (!byLetter[letter]) byLetter[letter] = [];
    byLetter[letter].push(e);
  }
  const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const presentLetters = Object.keys(byLetter).sort();

  const countsText = `${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'} across ${presentLetters.length} of 26 letters.`;

  const jumpbarHTML = allLetters.map(L => {
    if (byLetter[L]) return `<a href="#letter-${L}">${L}</a>`;
    return `<a class="empty" aria-disabled="true">${L}</a>`;
  }).join('');

  const sectionsHTML = presentLetters.map(L => {
    const items = byLetter[L].map(e => {
      const dateLabel = new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      return `<li><a href="entries/${e.date}.html"><span class="az-entry-word">${esc(e.word)}</span><span class="az-entry-date">${dateLabel}</span></a></li>`;
    }).join('\n          ');
    return `<section class="az-section" id="letter-${L}">
        <h3 class="az-letter-heading">${L}</h3>
        <ul class="az-entry-list">
          ${items}
        </ul>
      </section>`;
  }).join('\n      ');

  let out = html;
  out = replaceById(out, 'az-counts', countsText);
  out = replaceById(out, 'az-jumpbar', jumpbarHTML);
  out = replaceById(out, 'az-sections', '\n      ' + sectionsHTML + '\n    ');

  await fs.writeFile(path.join(ROOT, 'a-z.html'), out);
  console.log(`[prerender-az] a-z.html prerendered: ${sorted.length} entries across ${presentLetters.length} letters`);
}

main().catch(e => { console.error('[prerender-az] FATAL:', e); process.exit(1); });
