/**
 * Buffer queue manager.
 *
 * Modes (env: ACTION):
 *   list         — list scheduled posts across channels, returns JSON
 *   delete-by-match — delete posts whose text contains any string in MATCH_TERMS (newline-separated)
 *   delete-id    — delete a single post by id (POST_ID)
 *
 * Env:
 *   BUFFER_ACCESS_TOKEN — required
 *   BUFFER_PROFILE_IDS — channel ids, comma separated (same format as post-to-buffer)
 *   ACTION             — list | delete-by-match | delete-id
 *   MATCH_TERMS        — newline-separated case-insensitive substrings to match for delete-by-match
 *   POST_ID            — for delete-id mode
 *   DRY_RUN            — '1' to skip the actual delete call
 */

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILES = (process.env.BUFFER_PROFILE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TOKEN) { console.error('FATAL: BUFFER_ACCESS_TOKEN missing'); process.exit(1); }
if (PROFILES.length === 0) { console.error('FATAL: BUFFER_PROFILE_IDS empty'); process.exit(1); }

const ACTION = (process.env.ACTION || 'list').trim();
const DRY = process.env.DRY_RUN === '1';
const BUFFER_GRAPHQL = 'https://graphql.buffer.com/';

function channelIdsFromProfiles() {
  // BUFFER_PROFILE_IDS is "service:channelId,service:channelId" — strip the service prefix
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
  if (!res.ok) throw new Error(`Buffer ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}

async function listPostsForChannel(channelId) {
  // Try a known Buffer query — get scheduled posts for a channel
  const query = `
    query GetPosts($channelId: ChannelId!) {
      posts(input: { channelIds: [$channelId], status: queue }) {
        edges {
          node {
            id
            text
            dueAt
            status
            channel { id name service }
          }
        }
      }
    }
  `;
  try {
    const data = await gql(query, { channelId });
    return (data?.posts?.edges || []).map(e => e.node);
  } catch (e) {
    // Buffer's schema sometimes differs — try alternative shape
    console.error(`[buffer-queue] list for ${channelId} failed: ${e.message.slice(0, 200)}`);
    return [];
  }
}

async function deletePost(postId) {
  const mutation = `
    mutation DeletePost($postId: PostId!) {
      deletePost(input: { id: $postId }) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }
  `;
  const data = await gql(mutation, { postId });
  return data?.deletePost;
}

async function main() {
  const channels = channelIdsFromProfiles();
  console.log(`[buffer-queue] action=${ACTION} channels=${channels.length} dry=${DRY}`);

  if (ACTION === 'list') {
    const all = [];
    for (const ch of channels) {
      const posts = await listPostsForChannel(ch);
      all.push(...posts);
    }
    console.log(`\nFound ${all.length} scheduled posts:`);
    for (const p of all) {
      const text = (p.text || '').slice(0, 120).replace(/\n/g, ' ');
      console.log(`  id=${p.id} ch=${p.channel?.service}:${p.channel?.id?.slice(0,6)}... due=${p.dueAt || '?'} text="${text}"`);
    }
    // Write to stdout-readable file for the workflow to pick up
    const fs = await import('node:fs/promises');
    await fs.writeFile('/tmp/buffer-queue.json', JSON.stringify(all, null, 2), 'utf8');
    return;
  }

  if (ACTION === 'delete-by-match') {
    const termsRaw = process.env.MATCH_TERMS || '';
    const terms = termsRaw.split('\n').map(t => t.trim()).filter(Boolean);
    if (terms.length === 0) { console.error('FATAL: MATCH_TERMS empty'); process.exit(1); }
    console.log(`Match terms (${terms.length}):`);
    terms.forEach(t => console.log(`  "${t}"`));

    const all = [];
    for (const ch of channels) {
      const posts = await listPostsForChannel(ch);
      all.push(...posts);
    }
    const targets = all.filter(p => {
      const t = (p.text || '').toLowerCase();
      return terms.some(term => t.includes(term.toLowerCase()));
    });
    console.log(`\nMatched ${targets.length} posts to delete:`);
    let success = 0, fail = 0;
    for (const p of targets) {
      const preview = (p.text || '').slice(0, 80).replace(/\n/g, ' ');
      console.log(`  → ${p.id}: "${preview}…"`);
      if (DRY) { console.log('    (DRY_RUN, skipped)'); continue; }
      try {
        const r = await deletePost(p.id);
        if (r?.post?.id) { success++; console.log('    deleted'); }
        else { fail++; console.log(`    failed: ${JSON.stringify(r).slice(0,200)}`); }
      } catch (e) { fail++; console.error(`    error: ${e.message.slice(0,200)}`); }
    }
    console.log(`\nDone. ${success} deleted, ${fail} failed.`);
    return;
  }

  if (ACTION === 'delete-id') {
    const id = process.env.POST_ID;
    if (!id) { console.error('FATAL: POST_ID required'); process.exit(1); }
    if (DRY) { console.log(`DRY_RUN: would delete ${id}`); return; }
    const r = await deletePost(id);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.error(`Unknown ACTION: ${ACTION}`);
  process.exit(1);
}

main().catch(err => { console.error('[buffer-queue] FATAL:', err.message); process.exit(1); });
