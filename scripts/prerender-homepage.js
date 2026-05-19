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
  const re = new RegExp(`(<[a-z0-9]+\\s+[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(</[a-z0-9]+>)`, 'i');
  return html.replace(re, (m, open, _old, close) => `${open}${newInner}${close}`);
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

  // featured-image (wrap img in link to entry permalink)
  if (f.image) {
    const slug = f.date;
    const imgHTML = `<a href="entries/${slug}.html"><img src="${esc(f.image)}" alt="${esc(f.word)}" /></a>`;
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

  await fs.writeFile(INDEX, out, 'utf8');
  console.log(`[prerender] index.html updated, ${out.length} bytes`);
}

main().catch(e => { console.error('[prerender] FATAL:', e); process.exit(1); });
