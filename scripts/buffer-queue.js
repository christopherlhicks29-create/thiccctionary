/**
 * Buffer queue manager — uses GraphQL to list/delete posts. v2.
 *
 * Always writes /tmp/buffer-queue.log with full activity for debugging.
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILES = (process.env.BUFFER_PROFILE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TOKEN) { console.error('FATAL: BUFFER_ACCESS_TOKEN missing'); process.exit(1); }

const ACTION = (process.env.ACTION || 'list').trim();
const DRY = process.env.DRY_RUN === '1';
const BUFFER_GRAPHQL = 'https://graphql.buffer.com/';

const logLines = [];
function log(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.log(line);
  logLines.push(line);
}
// Always write log on exit
process.on('exit', () => {
  try {
    const fsSync = require('node:fs');
    fsSync.writeFileSync('/tmp/buffer-queue.log', logLines.join('\n') + '\n');
  } catch (e) { /* ignore */ }
});
// Startup marker so we know the script even started
log('[buffer-queue] script started at', new Date().toISOString());

function channelIdsFromProfiles() {
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

async function introspectQueryField(fieldName) {
  // Get the schema info for a top-level Query field
  const q = `{ __schema { queryType { fields { name args { name type { name kind ofType { name kind } } } type { name kind ofType { name kind } } } } } }`;
  const r = await gql(q);
  if (!r.ok) { log('introspect failed:', JSON.stringify(r.errors || r.status).slice(0, 200)); return null; }
  const field = r.data.__schema.queryType.fields.find(f => f.name === fieldName);
  return field;
}

async function listAllAvailableQueries() {
  const q = `{ __schema { queryType { fields { name } } } }`;
  const r = await gql(q);
  if (!r.ok) { log('list queries failed'); return []; }
  return r.data.__schema.queryType.fields.map(f => f.name);
}

async function listAllAvailableMutations() {
  const q = `{ __schema { mutationType { fields { name } } } }`;
  const r = await gql(q);
  if (!r.ok) return [];
  return r.data.__schema.mutationType.fields.map(f => f.name);
}

async function tryListShapes(channelIds) {
  // Try multiple query shapes until one works
  const shapes = [
    // Shape 1: posts(input: {channelIds, status})
    {
      name: 'posts-input',
      query: `query Q($cids: [ChannelId!]!) { posts(input: { channelIds: $cids, status: queue }) { edges { node { id text dueAt } } } }`,
      vars: { cids: channelIds },
      extract: d => (d?.posts?.edges || []).map(e => e.node),
    },
    // Shape 2: scheduledPosts(channelIds:[ID])
    {
      name: 'scheduledPosts',
      query: `query Q($cids: [String!]!) { scheduledPosts(channelIds: $cids) { id text dueAt } }`,
      vars: { cids: channelIds },
      extract: d => d?.scheduledPosts || [],
    },
    // Shape 3: findPosts (channelIds, statuses)
    {
      name: 'findPosts',
      query: `query Q($cids: [String!]!) { findPosts(channelIds: $cids, statuses: [queue]) { id text dueAt } }`,
      vars: { cids: channelIds },
      extract: d => d?.findPosts || [],
    },
    // Shape 4: simplified posts(channelIds)
    {
      name: 'posts-simple',
      query: `query Q($cids: [String!]!) { posts(channelIds: $cids) { id text dueAt status } }`,
      vars: { cids: channelIds },
      extract: d => d?.posts || [],
    },
  ];

  for (const shape of shapes) {
    log(`Trying query shape: ${shape.name}`);
    const r = await gql(shape.query, shape.vars);
    if (r.ok) {
      const posts = shape.extract(r.data);
      log(`  → success, ${posts.length} posts`);
      return { shape: shape.name, posts };
    } else {
      log(`  → ${JSON.stringify(r.errors || r.status).slice(0, 200)}`);
    }
  }
  return { shape: null, posts: [] };
}

async function tryDeleteShapes(postId) {
  const mutations = [
    { name: 'deletePost', query: `mutation M($id: ID!) { deletePost(input: { id: $id }) { __typename } }`, vars: { id: postId } },
    { name: 'discardPost', query: `mutation M($id: ID!) { discardPost(input: { id: $id }) { __typename } }`, vars: { id: postId } },
    { name: 'removePost', query: `mutation M($id: PostId!) { removePost(input: { postId: $id }) { __typename } }`, vars: { id: postId } },
  ];
  for (const m of mutations) {
    log(`  trying delete shape: ${m.name}`);
    const r = await gql(m.query, m.vars);
    if (r.ok) { log(`    → success via ${m.name}`); return true; }
    log(`    → ${JSON.stringify(r.errors || r.status).slice(0, 200)}`);
  }
  return false;
}

async function writeLog() {
  await fs.writeFile('/tmp/buffer-queue.log', logLines.join('\n') + '\n', 'utf8');
}

async function main() {
  const channels = channelIdsFromProfiles();
  log(`action=${ACTION} channels=${channels.length} dry=${DRY}`);
  log(`channels: ${channels.join(', ')}`);

  if (ACTION === 'introspect') {
    const queries = await listAllAvailableQueries();
    const mutations = await listAllAvailableMutations();
    log(`Available queries (${queries.length}):`); queries.forEach(q => log('  ' + q));
    log(`Available mutations (${mutations.length}):`); mutations.forEach(m => log('  ' + m));
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify({ queries, mutations }, null, 2), 'utf8');
    await writeLog();
    return;
  }

  const { shape, posts } = await tryListShapes(channels);
  if (!shape) {
    log('NO QUERY SHAPE WORKED. Buffer GraphQL schema may have changed.');
    await writeLog();
    process.exit(1);
  }

  if (ACTION === 'list') {
    log(`\n${posts.length} posts found:`);
    posts.forEach(p => log(`  id=${p.id} text="${(p.text||'').slice(0,80).replace(/\n/g,' ')}"`));
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify(posts, null, 2), 'utf8');
    await writeLog();
    return;
  }

  if (ACTION === 'delete-by-match') {
    const termsRaw = process.env.MATCH_TERMS || '';
    const terms = termsRaw.split('\n').map(t => t.trim()).filter(Boolean);
    log(`\nMatch terms (${terms.length}): ${JSON.stringify(terms)}`);
    const targets = posts.filter(p => {
      const t = (p.text || '').toLowerCase();
      return terms.some(term => t.includes(term.toLowerCase()));
    });
    log(`\nMatched ${targets.length} of ${posts.length}:`);
    let success = 0, fail = 0;
    for (const p of targets) {
      log(`  → ${p.id}: "${(p.text||'').slice(0,80).replace(/\n/g,' ')}"`);
      if (DRY) { log('    (DRY_RUN)'); continue; }
      const ok = await tryDeleteShapes(p.id);
      if (ok) success++; else fail++;
    }
    log(`\nDone. deleted=${success} failed=${fail}`);
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify({ matched: targets.length, deleted: success, failed: fail }, null, 2), 'utf8');
    await writeLog();
    return;
  }

  log(`Unknown ACTION: ${ACTION}`);
  process.exit(1);
}

main().catch(async err => {
  log('FATAL:', err.message);
  try { await writeLog(); } catch (e) {}
  process.exit(1);
});
