/**
 * Send the day's entry to Buttondown subscribers as a newsletter.
 *
 * Reads the latest entry from data/entries.json, formats it as a markdown
 * email, and POSTs to Buttondown's API to publish + send.
 *
 * Triggered by .github/workflows/post-on-merge.yml — runs after the daily
 * PR is merged, after the Buffer social post, after Cloudflare Pages deploys.
 *
 * Required env vars:
 *   - BUTTONDOWN_API_KEY      Buttondown personal API key
 *   - SITE_BASE_URL           e.g. https://thiccctionary.com (no trailing slash)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

function formatBody(entry, baseUrl) {
  // Wave 79: entry.image may be absolute (submission R2 URLs) — don't double-prefix.
  const isAbsoluteImg = /^https?:\/\//i.test(entry.image || '');
  const imageUrl = isAbsoluteImg ? entry.image : `${baseUrl}/${entry.image}`;
  const entryUrl = `${baseUrl}/entries/${entry.date}.html`;
  const defs = entry.definitions.map((d, i) => {
    const label = entry.definitions.length > 1 ? `**${i + 1}.** ` : '';
    return `${label}${stripHtml(d)}`;
  }).join('\n\n');

  return `# ${entry.word}

*${entry.pronunciation}* · *${entry.partOfSpeech}*

![${entry.word}](${imageUrl})

${defs}

**Etymology.** ${stripHtml(entry.etymology)}

> ${stripHtml(entry.example)}

---

[Read the full entry on Thiccctionary →](${entryUrl})

Photo by [${entry.photographer}](${entry.photographerUrl || baseUrl})${(entry.unsplashUrl && entry.unsplashUrl.includes('unsplash.com')) ? ' on [Unsplash](https://unsplash.com)' : ''}.
`;
}

async function main() {
  if (!process.env.BUTTONDOWN_API_KEY) {
    console.error('BUTTONDOWN_API_KEY required.');
    process.exit(1);
  }
  const baseUrl = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  // Wave 80: TARGET_DATE override for backfill
  const targetDate = (process.env.TARGET_DATE || '').trim();
  let entry;
  if (targetDate) {
    entry = entries.find(e => e.date === targetDate);
    if (entry) {
      console.log(`TARGET_DATE override: sending newsletter for ${targetDate} — ${entry.word}`);
    } else {
      console.warn(`TARGET_DATE=${targetDate} but no entry with that date. Falling back to entries[0].`);
      entry = entries[0];
    }
  } else {
    entry = entries[0];
  }
  if (!entry) {
    console.error('No entries found in data/entries.json');
    process.exit(1);
  }
  console.log(`Sending newsletter for: ${entry.date} — ${entry.word}`);

  const subject = `Word of the day: ${entry.word}`;
  const body = formatBody(entry, baseUrl);

  const res = await fetch('https://api.buttondown.com/v1/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
      'X-Buttondown-Live-Dangerously': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      body,
      email_type: 'public',
      status: 'about_to_send',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Buttondown API failed: ${res.status} ${text}`);
    process.exit(1);
  }
  const result = await res.json();
  console.log(`✅ Newsletter sent. Email ID: ${result.id || '(no id returned)'}`);
}

main().catch(err => { console.error(err); process.exit(1); });
