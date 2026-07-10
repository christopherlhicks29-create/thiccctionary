#!/usr/bin/env node
/**
 * Wave 230g: auto-link institutional canon references in generated HTML.
 *
 * Pass a path to an HTML file; this script rewrites text mentions of canon
 * references (Grievance Nos., Precedents, Amendments, Standing Orders,
 * Style Guide sections, methodology memos, named entry titles) into proper
 * hyperlinks. Idempotent, won't double-wrap already-anchored text.
 *
 * Use in: mailbag generator, from-the-boat generator, grievance generator,
 * office-post generator, daily-entry generator, weekly article generator.
 * Anything that produces Bart-voice or editorial-board-voice content.
 *
 * Usage:
 *   node scripts/auto-link-references.js path/to/file.html
 */
import fs from 'node:fs/promises';

const REFS = [
  {
    pattern: /Grievance Nos\. (\d+)(?:, (\d+))?(?:,? and (\d+))?\b/g,
    replace: (m, a, b, c) => {
      const link = n => `<a href="/about/documents/personnel-file/#grievance-${n}">${n}</a>`;
      // Wave 230m fix: handle (a, undefined, c) -- "Grievance Nos. X and Y" without middle comma
      const nums = [a, b, c].filter(Boolean);
      const linked = nums.map(link);
      if (linked.length === 1) return `Grievance Nos. ${linked[0]}`;
      if (linked.length === 2) return `Grievance Nos. ${linked[0]} and ${linked[1]}`;
      return `Grievance Nos. ${linked[0]}, ${linked[1]}, and ${linked[2]}`;
    },
  },
  {
    pattern: /Grievance No\. (\d+)\b/g,
    replace: (m, n) => `<a href="/about/documents/personnel-file/#grievance-${n}">Grievance No. ${n}</a>`,
  },
  { pattern: /Precedent 2009-03\b/g, replace: '<a href="/about/documents/atlantic-giant-2009/">Precedent 2009-03</a>' },
  { pattern: /Atlantic Giant Decision of (March )?2009\b/g, replace: '<a href="/about/documents/atlantic-giant-2009/">Atlantic Giant Decision of $12009</a>' },
  { pattern: /\bAtlantic Giant Decision\b(?![ ]of)/g, replace: '<a href="/about/documents/atlantic-giant-2009/">Atlantic Giant Decision</a>' },
  { pattern: /Amendment 1991-08\b/g, replace: '<a href="/about/documents/amendment-1991-08/">Amendment 1991-08</a>' },
  // Wave 290: the Jon canon (CEO rule: every referenced document links)
  { pattern: /Commendation 2019-03\b/g, replace: '<a href="/about/documents/commendation-2019-03/">Commendation 2019-03</a>' },
  { pattern: /Workplace Concern Form\b(?! 2026)/g, replace: '<a href="/about/documents/workplace-concern-2026-07/">Workplace Concern Form</a>' },
  { pattern: /Form 12-B\b/g, replace: '<a href="/about/documents/form-12-b/">Form 12-B</a>' },
  { pattern: /Role-Scope Alignment No\. (\d+)\b/g, replace: (m, n) => `<a href="/about/documents/role-scope-alignment/#alignment-${String(n).padStart(2, '0')}">Role-Scope Alignment No. ${n}</a>` },
  { pattern: /\bposition description\b/g, replace: '<a href="/about/documents/position-description-circulation/">position description</a>' },
  { pattern: /2014 Submissions Freeze Proposal\b/g, replace: '<a href="/about/documents/submissions-freeze/">2014 Submissions Freeze Proposal</a>' },
  { pattern: /Submissions Freeze Proposal\b/g, replace: '<a href="/about/documents/submissions-freeze/">Submissions Freeze Proposal</a>' },
  { pattern: /Standing Order on External Bodies\b/g, replace: '<a href="/about/documents/external-bodies/">Standing Order on External Bodies</a>' },
  { pattern: /Founding Charter\b/g, replace: '<a href="/about/documents/founding-charter/">Founding Charter</a>' },
  { pattern: /Liebherr Memo\b/g, replace: '<a href="/about/documents/liebherr-memo/">Liebherr Memo</a>' },
  { pattern: /methodology memo(?:randum)? of 1999\b/gi, replace: '<a href="/about/documents/methodology-memo-1999/">methodology memo of 1999</a>' },
  { pattern: /\bmethodology memo\b/gi, replace: '<a href="/about/documents/methodology-memo-1999/">methodology memo</a>' },
  { pattern: /Style Guide, Section ([IVX]+)(\.\d+)?\b/g, replace: '<a href="/about/style-guide/">Style Guide, Section $1$2</a>' },
  { pattern: /\bStyle Guide\b(?!,)/g, replace: '<a href="/about/style-guide/">Style Guide</a>' },
  { pattern: /the Personnel File\b/g, replace: '<a href="/about/documents/personnel-file/">the Personnel File</a>' },
];

export function autoLink(html) {
  let out = html;
  const parts = out.split(/(<a [^>]*>[^<]*<\/a>)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('<a ')) continue;
    let chunk = parts[i];
    for (const ref of REFS) {
      chunk = chunk.replace(ref.pattern, ref.replace);
    }
    parts[i] = chunk;
  }
  let joined = parts.join('');
  // Wave 281: LLM drafts sometimes write "the Founding Charter (/about/documents/founding-charter/)"
  // in prose. Once the name is linked, the parenthetical raw path is redundant and renders
  // as literal text on the live page (caught by Christopher, mailbag 2026-07-01). Strip any
  // site-internal path parenthetical that immediately follows a closing anchor.
  joined = joined.replace(/<\/a>\s*\((\/[a-z0-9][a-z0-9\/-]*\/?)\)/g, '</a>');
  return joined;
}

async function main() {
  const p = process.argv[2];
  if (!p) { console.error('Usage: auto-link-references.js <html-file>'); process.exit(1); }
  const before = await fs.readFile(p, 'utf8');
  const after = autoLink(before);
  if (before === after) {
    console.log(`[auto-link] no changes for ${p}`);
    return;
  }
  await fs.writeFile(p, after);
  const beforeAnchors = (before.match(/<a href="\/about\//g) || []).length;
  const afterAnchors = (after.match(/<a href="\/about\//g) || []).length;
  console.log(`[auto-link] ${p}: ${beforeAnchors} -> ${afterAnchors} /about/ links`);
}

if (process.argv[1] && process.argv[1].endsWith('auto-link-references.js')) main();
