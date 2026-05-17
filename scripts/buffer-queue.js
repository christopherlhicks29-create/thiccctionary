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
const BUFFER_GRAPHQL = 'https://api.buffer.com/';

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

async function getOrganizationId() {
  const r = await gql('{ account { organizations { id } } }');
  if (!r.ok) return null;
  return r.data?.account?.organizations?.[0]?.id || null;
}

async function listPosts(channelIds, statuses) {
  const orgId = await getOrganizationId();
  if (!orgId) { log('could not get organizationId'); return []; }
  log(`org=${orgId}`);

  // Try with various status enum values
  const statusVariants = statuses ? [statuses] : [['scheduled'], ['queue'], ['draft', 'scheduled'], ['queued']];
  for (const statusVal of statusVariants) {
    const q = `query Q($input: PostsInput!) {
      posts(input: $input, first: 100) {
        edges { node { id text dueAt status channelId } }
      }
    }`;
    const vars = {
      input: {
        organizationId: orgId,
        filter: { channelIds, status: statusVal },
      },
    };
    log(`Trying status: ${JSON.stringify(statusVal)}`);
    const r = await gql(q, vars);
    if (r.ok) {
      const posts = (r.data?.posts?.edges || []).map(e => e.node);
      log(`  → found ${posts.length} posts`);
      return posts;
    }
    log(`  → ${JSON.stringify(r.errors || r.status).slice(0, 250)}`);
  }
  return [];
}

async function tryListShapes(channelIds) {
  // Use the schema-verified working shape
  const posts = await listPosts(channelIds);
  return { shape: 'verified', posts };
}

async function legacy_tryListShapes_unused(channelIds) {
  const shapes = [
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
  // Verified shape: deletePost(input: DeletePostInput!) where DeletePostInput.id is PostId
  const q = `mutation M($input: DeletePostInput!) { deletePost(input: $input) { __typename ... on PostActionSuccess { post { id } } ... on MutationError { message } } }`;
  const r = await gql(q, { input: { id: postId } });
  if (r.ok) {
    const dp = r.data?.deletePost;
    if (dp?.message) { log(`    deletePost returned error: ${dp.message}`); return false; }
    log(`    → success`);
    return true;
  }
  log(`    → ${JSON.stringify(r.errors || r.status).slice(0, 200)}`);
  return false;
}

async function writeLog() {
  await fs.writeFile('/tmp/buffer-queue.log', logLines.join('\n') + '\n', 'utf8');
}

async function main() {
  const channels = channelIdsFromProfiles();
  log(`action=${ACTION} channels=${channels.length} dry=${DRY}`);
  log(`channels: ${channels.join(', ')}`);

  if (ACTION === 'rest-test') {
    log('Trying REST API...');
    const profiles = await restListProfiles();
    log(`Got ${profiles.length} profiles via REST`);
    if (profiles.length === 0) { await writeLog(); return; }
    for (const p of profiles) {
      log(`  profile id=${p.id} service=${p.service} formatted_username=${p.formatted_username || '?'}`);
      const pending = await restListPending(p.id);
      log(`    ${pending.length} pending updates`);
      pending.slice(0, 5).forEach(u => log(`      ${u.id}: "${(u.text || '').slice(0, 80).replace(/\n/g, ' ')}"`));
    }
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify({ profiles, ts: new Date().toISOString() }, null, 2), 'utf8');
    await writeLog();
    return;
  }

  if (ACTION === 'rest-delete-by-match') {
    const termsRaw = process.env.MATCH_TERMS || '';
    const terms = termsRaw.split('\n').map(t => t.trim()).filter(Boolean);
    log(`Match terms: ${JSON.stringify(terms)}`);
    const profiles = await restListProfiles();
    let totalMatched = 0, deleted = 0, failed = 0;
    for (const profile of profiles) {
      const pending = await restListPending(profile.id);
      const matched = pending.filter(u => {
        const t = (u.text || '').toLowerCase();
        return terms.some(term => t.includes(term.toLowerCase()));
      });
      log(`Profile ${profile.formatted_username || profile.service}: ${matched.length} of ${pending.length} match`);
      for (const u of matched) {
        totalMatched++;
        log(`  → ${u.id}: "${(u.text || '').slice(0, 80).replace(/\n/g, ' ')}"`);
        if (DRY) { log('    (DRY_RUN)'); continue; }
        const ok = await restDelete(`/updates/${u.id}/destroy.json`);
        if (ok) deleted++; else failed++;
      }
    }
    log(`\nDone. matched=${totalMatched} deleted=${deleted} failed=${failed}`);
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify({ matched: totalMatched, deleted, failed }, null, 2), 'utf8');
    await writeLog();
    return;
  }

  if (ACTION === 'introspect') {
    const queries = await listAllAvailableQueries();
    const mutations = await listAllAvailableMutations();
    log(`Queries (${queries.length}): ${queries.join(', ')}`);
    log(`Mutations (${mutations.length}): ${mutations.join(', ')}`);

    // Detailed introspection of posts query + deletePost mutation
    const detailQ = `{ __type(name: "Query") { fields(includeDeprecated: false) { name args { name type { name kind ofType { name kind ofType { name kind } } } } type { name kind ofType { name kind } } } } }`;
    const detailR = await gql(detailQ);
    let queryDetails = null;
    if (detailR.ok) {
      queryDetails = detailR.data.__type.fields.find(f => f.name === 'posts');
      log('posts query details: ' + JSON.stringify(queryDetails));
    }

    const detailMQ = `{ __type(name: "Mutation") { fields { name args { name type { name kind ofType { name kind ofType { name kind } } } } } } }`;
    const detailM = await gql(detailMQ);
    let deleteDetails = null;
    if (detailM.ok) {
      deleteDetails = detailM.data.__type.fields.find(f => f.name === 'deletePost');
      log('deletePost mutation details: ' + JSON.stringify(deleteDetails));
    }

    // Also introspect the PostsInput type if it exists
    const inputTypes = ['PostsInput', 'PostsFiltersInput', 'PostsFilter', 'DeletePostInput', 'PostsResults', 'Post', 'OrganizationId', 'Account'];
    const typeInfos = {};
    for (const t of inputTypes) {
      const r = await gql(`{ __type(name: "${t}") { name inputFields { name type { name kind ofType { name kind } } } } }`);
      if (r.ok && r.data.__type) { typeInfos[t] = r.data.__type; log(`Input type ${t}: ` + JSON.stringify(r.data.__type)); }
    }

    // Try to get account info (which should contain orgId)
    const acctR = await gql('{ account { id name organizations { id name } } }');
    let account = null;
    if (acctR.ok) { account = acctR.data.account; log('account: ' + JSON.stringify(account).slice(0, 300)); }
    else { log('account query failed: ' + JSON.stringify(acctR.errors || acctR.status).slice(0, 200)); }

    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify({ queries, mutations, queryDetails, deleteDetails, typeInfos, account }, null, 2), 'utf8');
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



// REST API fallback. Buffer's legacy REST API: api.bufferapp.com/1/...
const REST_BASES = ['https://api.bufferapp.com/1', 'https://api.buffer.com/1'];

async function restGet(pathSuffix) {
  for (const base of REST_BASES) {
    // Try with Bearer token header (modern) AND with access_token query param (legacy)
    const url = `${base}${pathSuffix}`;
    log(`REST GET ${base}${pathSuffix}`);
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      const body = await res.text();
      if (res.ok) {
        log(`  ok ${res.status}, ${body.length} bytes`);
        return { ok: true, base, body, status: res.status };
      } else {
        log(`  ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (e) { log(`  error ${base}: ${e.message}`); }
  }
  return { ok: false };
}

async function restDelete(pathSuffix) {
  for (const base of REST_BASES) {
    const url = `${base}${pathSuffix}?access_token=${encodeURIComponent(TOKEN)}`;
    log(`REST DELETE ${base}${pathSuffix}`);
    try {
      const res = await fetch(url, { method: 'POST' });  // Buffer DELETE uses POST to /destroy endpoints
      const body = await res.text();
      log(`  ${res.status}: ${body.slice(0, 200)}`);
      if (res.ok) return true;
    } catch (e) { log(`  error: ${e.message}`); }
  }
  return false;
}

async function restListProfiles() {
  const r = await restGet('/profiles.json');
  if (!r.ok) return [];
  try { return JSON.parse(r.body); } catch (e) { log(`parse profiles failed`); return []; }
}

async function restListPending(profileId) {
  const r = await restGet(`/profiles/${profileId}/updates/pending.json`);
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.body);
    return data.updates || [];
  } catch (e) { log(`parse pending failed`); return []; }
}

main().catch(async err => {
  log('FATAL:', err.message);
  try { await writeLog(); } catch (e) {}
  process.exit(1);
});
