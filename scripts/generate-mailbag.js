#!/usr/bin/env node
/**
 * Wave 210: Wednesday Mailbag.
 *
 * Bartholomew (Senior Cataloguer) replies to a handful of "letters to the
 * editor." Letters are fabricated by the LLM; the joke is that this section
 * runs in a brand-voice deadpan as though the letters were real. Topics span
 * thiccc taxonomy, office matters (Reginald, the coffee machine, Teddy's
 * objections), and geopolitics seen through Bart's catalogue-thumping
 * worldview.
 *
 * Output: articles/mailbag-YYYY-MM-DD.html + articles.json update.
 * Cadence: Wednesdays 16:00 UTC, via mailbag.yml.
 * Manual fire: data/.fire-mailbag sentinel or workflow_dispatch.
 *
 * Env required: ANTHROPIC_API_KEY.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

async function callClaude(systemPrompt, userPrompt, model = 'claude-sonnet-4-6') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

const SYSTEM_PROMPT = `You are Bartholomew "Bart" Whitmore, Senior Cataloguer at the Thiccctionary, satirical daily dictionary of thiccc things.

Your voice: dry to the point of mineral. Treats taxonomy with religious seriousness. 17 years at the publication. Wrote the original style guide. Believes the catalogue should have stopped accepting submissions in 2014. Mildly annoyed by everything.

Your tics:
- Talks like a person who's been doing this job too long
- Names specific objects (a file cabinet, a 1996 Buick entry, a Swingline 747 stapler)
- When you file something, you say WHAT and to WHO ("Filed objection to the records desk")
- Strong reflexive opinions on everything (geopolitics included)
- Documentary register; never wink at the joke; punchline always lands via specificity

AVOID these tics that have been overused:
- "does not a submission make" , Shakespearean inversion, retired
- "I have filed" / "I have noted" with no object , too clipped, too performative
- "The catalogue, properly understood" , keep to once per mailbag MAX
- Roman-numeraled lists in a short reply (essay tic; doesn't fit a letter)

CRITICAL FORMAT RULES:
1. The letter goes in a markdown blockquote (lines starting with ">")
2. Your reply is a plain paragraph IMMEDIATELY AFTER the blockquote
3. Do NOT prefix the reply with 'Your reply:' or any header. Just write the reply paragraph
4. NO em dashes anywhere. Use commas, semicolons, periods, or hyphens (-) instead
5. NO en dashes either

Task: Generate exactly 5 letters to the editor and your replies. Format strictly as MARKDOWN:

# Filed Replies, Vol. <N>
*Bartholomew Whitmore, Senior Cataloguer*

---

### From <First Initial>. <Last Name>, <City>:

> <Letter, 1-3 sentences. A reader complaint, question, or observation.>

<Your reply paragraph here. 2-5 sentences. Bart voice. NO leading 'Your reply:' label, NO em dashes, NO en dashes.>

---

(Repeat for 5 letters total.)

TOPIC SPREAD (5 letters, this mix):
- 2 letters about thiccc subjects (a cataloguing dispute, a submission you'd reject, a girth-criterion edge case)
- 2 letters about office matters (the coffee machine broken since March, Teddy refiling the Saturn V brief, Spider's expense reports postmarked from a different city than the dispatch, Bart's 1991 Liebherr T 282B entry he's secretly proud of, the credenza in his office, Margie filing from a yacht)
- 1 letter about geopolitics, world events, or current affairs . Bart approaches it as if it were a cataloguing problem. Examples: trade policy ("a tariff is a girth criterion, simply"), an election ("the ballot, properly designed, is a submission form"), a foreign war reduced to documentation issues, a tech CEO he treats like a junior cataloguer who hasn't filed correctly.

STYLE GUIDE: When Bart references 'The Style Guide' or 'the style guide,' he means a real document at https://thiccctionary.com/about/style-guide/, drafted 1978, last revised 2014. He can cite specific sections (Section I, II, III, IV, V, VI) or precedents (Precedent 1986-04 Liebherr T 282B, Precedent 1991-11 Toaster Toaster-Oven, Precedent 2009-03 Atlantic Giant Pumpkin, Precedent 2014-09 The Submissions Freeze). Don't invent sections that aren't there.

QUALITY BAR: Each reply must land for a stranger. Don't require reading 8 prior posts to get the joke. The joke is Bart's posture, not insider references.

Volume number to use in title: <VOL>`;

const today = process.env.TARGET_DATE || new Date().toISOString().slice(0, 10);

async function main() {
  // Count existing mailbags to set Volume number
  const articlesJsonPath = path.join(ROOT, 'data', 'articles.json');
  let articles = [];
  try { articles = JSON.parse(await fs.readFile(articlesJsonPath, 'utf8')); } catch {}
  const mailbagCount = articles.filter(a => (a.slug || '').startsWith('mailbag-')).length;
  const vol = mailbagCount + 1;

  console.log(`Generating Mailbag Vol. ${vol} for ${today}...`);
  const prompt = SYSTEM_PROMPT.replace('<VOL>', `Vol. ${vol}`);
  const markdown = await callClaude(prompt, `Generate Filed Replies, Vol. ${vol}. Today is ${today}.`);

  // Convert markdown to HTML (simple, since the template is fixed)
  const htmlBody = mdToHtml(markdown);
  const title = `Filed Replies, Vol. ${vol}`;
  const slug = `mailbag-${today}`;

  // Read template article
  const templatePath = path.join(ROOT, 'articles', 'history-of-thiccc.html');
  let template = '';
  try { template = await fs.readFile(templatePath, 'utf8'); } catch {}

  // Minimal article HTML
  const articleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}, Thiccctionary</title>
<meta name="description" content="Bartholomew Whitmore answers letters from readers. Mailbag, Vol. ${vol}." />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="Bartholomew Whitmore, Senior Cataloguer, replies to a handful of letters." />
<meta property="og:image" content="https://thiccctionary.com/articles/og/${slug}.png" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.min.css?v=68" />
<link rel="icon" type="image/svg+xml" href="../favicon.svg" />
</head>
<body>
<header class="masthead">
  <div class="masthead-top">
    <span class="meta-line">Vol. I &nbsp;&middot;&nbsp; Iss. <span id="issue-number">040</span> &nbsp;&middot;&nbsp; <span id="today-date">Friday, May 30, 2026</span></span>
    <span class="meta-line meta-line--right">Est. MMXXVI &nbsp;&middot;&nbsp; A Daily Reference</span>
  </div>
  <h1 class="wordmark" aria-label="Thiccctionary">
    <a href="/" class="wordmark-link" aria-label="Thiccctionary, home">
      <span class="wordmark-the">The</span>
      <span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
    </a>
  </h1>
  <nav class="nav">
    <a href="/" class="nav-link">Today's Entry</a>
    <a href="/archive.html" class="nav-link">The Archive</a>
    <a href="/a-z.html" class="nav-link">A-Z</a>
    <a href="/articles/" class="nav-link nav-link--active">Articles</a>
    <a href="/reels/" class="nav-link">Reels</a>
    <a href="/cartoons/" class="nav-link">Cartoons</a>
    <a href="/random.html" class="nav-link">Random</a>
    <a href="/compare.html" class="nav-link">Compare</a>
  </nav>
</header>
<main class="container article-body">
<p class="article-meta"><a href="./">&larr; All articles</a> &middot; ${today}</p>
${htmlBody}
</main>
<footer class="site-footer">
<p class="copyright">&copy; <span id="year">${today.slice(0,4)}</span> Thiccctionary<sup style="font-size:0.7em;">TM</sup>. All entries fictional. All letters fabricated.</p>
</footer>
<script defer src="/scripts/masthead-date.js?v=1"></script>\n</body>
</html>
`;

  const outPath = path.join(ROOT, 'articles', `${slug}.html`);
  await fs.writeFile(outPath, articleHtml, 'utf8');
  console.log(`Wrote ${outPath}`);

  // Update articles.json
  const entry = {
    slug,
    title,
    description: `Bartholomew Whitmore, Senior Cataloguer, replies to a handful of letters. Vol. ${vol}.`,
    date: today,
    author: 'Bartholomew Whitmore',
    type: 'mailbag',
  };
  // Remove any prior duplicate by slug
  articles = articles.filter(a => a.slug !== slug);
  articles.unshift(entry);
  await fs.writeFile(articlesJsonPath, JSON.stringify(articles, null, 2) + '\n');
  console.log(`Updated ${articlesJsonPath}`);

  console.log(`[mailbag] done. Vol. ${vol} written.`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inBlockquote = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^# /.test(ln)) {
      out.push(`<h1>${escapeHtml(ln.slice(2))}</h1>`);
    } else if (/^### /.test(ln)) {
      out.push(`<h3>${escapeHtml(ln.slice(4))}</h3>`);
    } else if (/^\*([^*]+)\*$/.test(ln)) {
      out.push(`<p class="article-byline"><em>${escapeHtml(ln.slice(1,-1))}</em></p>`);
    } else if (/^---/.test(ln)) {
      out.push('<hr />');
    } else if (/^> /.test(ln)) {
      out.push(`<blockquote><p>${escapeHtml(ln.slice(2))}</p></blockquote>`);
    } else if (ln.trim() === '') {
      // blank line, skip
    } else {
      out.push(`<p>${escapeHtml(ln)}</p>`);
    }
  }
  return out.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
