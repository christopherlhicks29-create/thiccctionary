/**
 * Posts the most recent entry to Buffer for IG / FB / Twitter.
 * Called by .github/workflows/post-on-merge.yml after a daily PR merges,
 * or manually by .github/workflows/test-buffer.yml.
 *
 * Uses Buffer's GraphQL API (post-2024). Personal Keys only work here,
 * not the legacy REST endpoint.
 *
 * Required env vars:
 *   - BUFFER_ACCESS_TOKEN     Personal Key from buffer.com → API
 *   - BUFFER_PROFILE_IDS      Comma-separated channel IDs (one per platform)
 *   - SITE_BASE_URL           e.g. https://thiccctionary.com — must be publicly resolvable
 *                             so Buffer can fetch the image
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const stripHtml = s => (s || '').replace(/<[^>]+>/g, '');

async function postToChannel({ channelId, text, imageUrl, token }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId,
      text,
      schedulingType: 'automatic',
      mode: 'addToQueue',
      imageUrl,
    },
  };

  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { ok: false, channelId, status: res.status, body: JSON.stringify(json) };
  }

  if (json.errors && json.errors.length > 0) {
    return { ok: false, channelId, status: 200, body: JSON.stringify(json.errors) };
  }

  const result = json.data?.createPost;
  if (result?.message) {
    return { ok: false, channelId, status: 200, body: result.message };
  }

  return { ok: true, channelId, postId: result?.post?.id };
}

async function main() {
  if (!process.env.BUFFER_ACCESS_TOKEN || !process.env.BUFFER_PROFILE_IDS) {
    console.log('Buffer not configured (missing token or profile IDs). Skipping.');
    return;
  }
  if (!process.env.SITE_BASE_URL) {
    console.error('SITE_BASE_URL not set — cannot construct public image URL.');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  const entry = entries[0];
  if (!entry) {
    console.log('No entries found. Nothing to post.');
    return;
  }

  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
  const imageUrl = `${baseUrl}/${entry.image}`;
  const channelIds = process.env.BUFFER_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean);

  const text = `📖 ${entry.word}

${stripHtml(entry.definitions[0])}

Today's entry → ${baseUrl}

#thiccctionary #thiccc #everydayobjects`;

  console.log(`Posting to ${channelIds.length} channels with image: ${imageUrl}`);

  const results = await Promise.all(
    channelIds.map(channelId =>
      postToChannel({ channelId, text, imageUrl, token: process.env.BUFFER_ACCESS_TOKEN })
    )
  );

  let successes = 0;
  let failures = 0;
  for (const r of results) {
    if (r.ok) {
      successes++;
      console.log(`✓ Posted to channel ${r.channelId} (post id: ${r.postId})`);
    } else {
      failures++;
      console.error(`✗ Failed channel ${r.channelId}: status=${r.status} body=${r.body}`);
    }
  }

  console.log(`\nSummary: ${successes} succeeded, ${failures} failed (out of ${results.length}).`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
