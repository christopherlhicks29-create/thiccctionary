#!/usr/bin/env node
/**
 * Wave 330: flag queued Buffer posts that reference entries which were just
 * regenerated or corrected. Entry corrections do NOT propagate to already-
 * queued posts (observed 2026-07-25/26: the Hummer H1 reel and the sliced-
 * mango reel both published with pre-correction content). This script is
 * REPORT-ONLY: it never deletes or edits posts. It writes
 * audits/stale-queue-flags/<stamp>.md listing queued posts whose text
 * mentions a regenerated entry, so the next PO session (or Christopher)
 * can review them in the Buffer UI before they publish stale.
 *
 * Env:
 *   BUFFER_ACCESS_TOKEN  Buffer API token (skips gracefully if absent)
 *   BUFFER_PROFILE_IDS   comma-separated, same format as post-to-buffer.js
 *   ENTRY_DATES          comma/space/newline separated YYYY-MM-DD list
 *
 * Always exits 0: report-only, must never fail a regen workflow.
 * Run from repo root: node scripts/flag-stale-queued-posts.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILES = (process.env.BUFFER_PROFILE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DATES = (process.env.ENTRY_DATES || '')
  .split(/[\s,]+/)
  .map(s => s.trim())
  .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));

function channelIds() {
  return PROFILES.map(p => {
    const i = p.indexOf(':');
    return i >= 0 ? p.slice(i + 1) : p;
  });
}

async function gql(query, variables = {}) {
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json.errors, status: res.status, data: json.data, errors: json.errors };
}

async function getOrganizationId() {
  const r = await gql('{ account { organizations { id } } }');
  return r.ok ? (r.data?.account?.organizations?.[0]?.id || null) : null;
}

// Same verified query shape as buffer-queue.js listPosts (Wave 227 lineage).
async function listQueuedPosts(orgId) {
  const cids = channelIds();
  const q = `query Q($input: PostsInput!) {
    posts(input: $input, first: 100) {
      edges { node { id text dueAt status channelId } }
    }
  }`;
  const seen = new Map();
  for (const statusVal of [['scheduled'], ['queue']]) {
    const r = await gql(q, { input: { organizationId: orgId, filter: { channelIds: cids, status: statusVal } } });
    if (!r.ok) {
      console.log(`  status=${statusVal} query failed: ${JSON.stringify(r.errors || r.status).slice(0, 200)}`);
      continue;
    }
    for (const e of (r.data?.posts?.edges || [])) seen.set(e.node.id, e.node);
  }
  return [...seen.values()];
}

function termsForEntry(entry) {
  const terms = new Set();
  if (entry.word) {
    terms.add(entry.word.toLowerCase());
    const head = entry.word.split(',')[0].trim().toLowerCase();
    if (head.length >= 4) terms.add(head);
  }
  if (entry.image) {
    const base = path.basename(String(entry.image)).replace(/\.\w+$/, '');
    if (base.length >= 8) terms.add(base.toLowerCase());
  }
  return [...terms];
}

async function main() {
  if (DATES.length === 0) { console.log('flag-stale-queued-posts: no ENTRY_DATES given; nothing to do.'); return; }
  if (!TOKEN || PROFILES.length === 0) { console.log('flag-stale-queued-posts: Buffer creds missing; skipping (report-only step).'); return; }

  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.entries || []);
  const targets = all.filter(e => DATES.includes(e.date));
  if (targets.length === 0) { console.log(`flag-stale-queued-posts: no entries found for dates ${DATES.join(', ')}.`); return; }

  const orgId = await getOrganizationId();
  if (!orgId) { console.log('flag-stale-queued-posts: could not resolve organizationId; skipping.'); return; }

  const posts = await listQueuedPosts(orgId);
  console.log(`flag-stale-queued-posts: scanned ${posts.length} queued/scheduled posts for ${targets.length} entries.`);

  const flags = [];
  for (const entry of targets) {
    const terms = termsForEntry(entry);
    for (const p of posts) {
      const text = (p.text || '').toLowerCase();
      const hit = terms.find(t => text.includes(t));
      if (hit) flags.push({ entry, post: p, term: hit });
    }
  }

  if (flags.length === 0) {
    console.log('flag-stale-queued-posts: FLAGGED 0. No queued posts reference the regenerated entries.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outDir = path.join(ROOT, 'audits', 'stale-queue-flags');
  await fs.mkdir(outDir, { recursive: true });
  const lines = [];
  lines.push('# Stale queued-post flags');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} after regeneration of: ${DATES.join(', ')}`);
  lines.push('');
  lines.push('These queued Buffer posts reference an entry that was just regenerated or');
  lines.push('corrected. Queued posts keep the OLD caption/image. Review each in the');
  lines.push('Buffer UI: update the text/media, or delete and re-queue via post-to-buffer.');
  lines.push('This report is informational; nothing was changed automatically.');
  lines.push('');
  for (const f of flags) {
    lines.push(`## Post ${f.post.id}`);
    lines.push(`- entry: ${f.entry.date} "${f.entry.word}" (matched term: "${f.term}")`);
    lines.push(`- channelId: ${f.post.channelId}`);
    lines.push(`- status: ${f.post.status}  dueAt: ${f.post.dueAt || 'n/a'}`);
    lines.push(`- text: ${String(f.post.text || '').slice(0, 200).replace(/\n/g, ' / ')}`);
    lines.push('');
  }
  const outPath = path.join(outDir, `${stamp}.md`);
  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`flag-stale-queued-posts: FLAGGED ${flags.length}. Report: ${path.relative(ROOT, outPath)}`);
}

main().catch(err => {
  console.log(`flag-stale-queued-posts: non-fatal error: ${err.message}`);
  process.exit(0);
});
