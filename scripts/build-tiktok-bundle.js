/**
 * Build a TikTok-ready bundle for the latest entry.
 *
 * Outputs:
 *   tiktok-ready/<date>/
 *     ├─ <date>-<slug>.mp4       (copy of videos/<date>.mp4)
 *     ├─ caption.txt             (TikTok-flavored caption with hook)
 *     └─ README.md               (1-line "how to post" instructions)
 *
 * Run by .github/workflows/build-tiktok-bundle.yml after the daily Reel
 * MP4 commits to videos/. Bundle is committed to main so Christopher can
 * pull it on his phone, copy the caption, and upload via TikTok app.
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - DATE                       YYYY-MM-DD of the entry to build
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').trim(); }

async function generateTikTokCaption(entry) {
  const def0 = stripHtml(entry.definitions?.[0] || '');
  const ex = stripHtml(entry.example || '');

  const sysPrompt = `You write TikTok captions for Thiccctionary — a satirical daily dictionary of thiccc inanimate objects. TikTok's culture is different from the Thiccctionary brand voice we use on FB/IG/X: it expects a HOOK in the first line, energetic absurdity, and a payoff. Pseudo-academic register only as a punchline contrast, not as the whole thing.

Output JSON with exactly these fields:
{
  "hook": "first line — 5-10 words, scroll-stopping. Should make someone curious enough to watch the video. NEVER use 'today's entry' or anything corporate. Examples: 'POV: you're explaining girth to your engineer dad', 'no bc tell me why an electrical transformer is gendered', 'the dictionary said WHAT about a refrigerator'",
  "body": "2-3 short lines. Where the actual joke lands. Can use the dictionary voice here as the contrast/punchline.",
  "hashtags": "5-7 hashtags. Mix: 1-2 brand (#thiccctionary #thiccc), 2-3 platform-relevant (#fyp #foryou #didyouknow), 2 topical to the subject (e.g., #infrastructure #engineering for a dam)"
}

Voice rules:
- The brand subject is always an OBJECT, never a person. Stay on-message.
- The word "thiccc" has THREE c's. Use it.
- No salesy CTAs. No "follow for more."
- Banned: voluptuous, curves, runway, diva, body, hourglass, slay, queen, OG, haters.

Tone exemplars (Bagger 288):
hook: "POV: you tried to explain Bagger 288 to a normal person"
body: "13,500 tons of forward motion. Walks two miles an hour. The Earth moves around it, professionally."
hashtags: "#thiccctionary #bagger288 #thiccc #fyp #engineering #infrastructure #didyouknow"`;

  const userPrompt = `Subject: ${entry.word}
Definition: ${def0}
Example: ${ex}
Category: ${entry.category || 'other'}

Write the TikTok caption JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.85,
    }),
  });
  if (!res.ok) throw new Error(`TikTok caption gen failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  const date = (process.env.DATE || '').trim();
  if (!date) {
    console.error('DATE required.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required.');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  const entry = entries.find(e => e.date === date);
  if (!entry) {
    console.error(`No entry for ${date}`);
    process.exit(1);
  }

  const mp4Src = path.join(ROOT, 'videos', `${date}.mp4`);
  try {
    await fs.access(mp4Src);
  } catch {
    console.error(`No MP4 at ${mp4Src}. Build the Reel first.`);
    process.exit(1);
  }

  const slug = entry.word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const bundleDir = path.join(ROOT, 'tiktok-ready', date);
  await fs.mkdir(bundleDir, { recursive: true });

  // Copy MP4 in
  const mp4Dst = path.join(bundleDir, `${date}-${slug}.mp4`);
  await fs.copyFile(mp4Src, mp4Dst);
  console.log(`Copied MP4 → ${path.relative(ROOT, mp4Dst)}`);

  // Generate TikTok caption
  const tk = await generateTikTokCaption(entry);
  const captionText = `${tk.hook}\n\n${tk.body}\n\n${tk.hashtags}\n`;
  const captionPath = path.join(bundleDir, 'caption.txt');
  await fs.writeFile(captionPath, captionText);
  console.log(`Wrote caption → ${path.relative(ROOT, captionPath)}`);

  // README
  const readme = `# TikTok bundle — ${date} — ${entry.word}

## How to post

1. On your phone, navigate to this folder in the GitHub repo OR pull the repo to your device.
2. Open \`${path.basename(mp4Dst)}\` in TikTok app → tap "Use this sound" or "Upload" depending on your TikTok version.
3. Paste the contents of \`caption.txt\` as the description.
4. Post.

The caption is TikTok-flavored (hook + body + hashtags) — different from the FB/IG voice. Don't paste the FB caption here; TikTok culture wants the hook style.

## Caption preview

\`\`\`
${captionText}
\`\`\`
`;
  await fs.writeFile(path.join(bundleDir, 'README.md'), readme);
  console.log(`Wrote README → ${path.relative(ROOT, path.join(bundleDir, 'README.md'))}`);

  console.log(`\nTikTok bundle ready: ${path.relative(ROOT, bundleDir)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
