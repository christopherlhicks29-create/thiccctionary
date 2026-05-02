/**
 * Posts the most recent entry to Buffer for IG / FB / Twitter.
 * Called by .github/workflows/post-on-merge.yml after a daily PR merges.
 *
 * Required env vars:
 *   - BUFFER_ACCESS_TOKEN
 *   - BUFFER_PROFILE_IDS    comma-separated Buffer profile IDs
 *   - SITE_BASE_URL         e.g. https://thiccctionary.com (so image URLs resolve)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

  const stripHtml = s => (s || '').replace(/<[^>]+>/g, '');
  const baseUrl = process.env.SITE_BASE_URL.replace(/\/$/, '');
  const imageUrl = `${baseUrl}/${entry.image}`;
  const linkUrl = baseUrl;

  const text = `📖 ${entry.word}

${stripHtml(entry.definitions[0])}

Today's entry → thiccctionary.com

#thiccctionary #thiccc #everydayobjects`;

  const profileIds = process.env.BUFFER_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean);
  const params = new URLSearchParams();
  profileIds.forEach(id => params.append('profile_ids[]', id));
  params.append('text', text);
  params.append('media[link]', linkUrl);
  params.append('media[picture]', imageUrl);
  params.append('media[thumbnail]', imageUrl);
  params.append('shorten', 'true');

  const res = await fetch('https://api.bufferapp.com/1/updates/create.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    },
    body: params,
  });

  if (!res.ok) {
    console.error(`Buffer post failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`Posted to Buffer. Updates created: ${(result.updates || []).length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
