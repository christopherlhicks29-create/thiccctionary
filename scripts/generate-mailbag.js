#!/usr/bin/env node
/**
 * Wave 210: Wednesday Mailbag.
 *
 * Bartholomew (Senior Cataloguer) replies to a handful of "letters to the
 * editor." Letters are fabricated by the LLM; the joke is that this section
 * runs in a brand-voice deadpan as though the letters were real. Topics span
 * thiccc taxonomy, office matters (the coffee machine, Teddy's
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
import { autoLink } from './auto-link-references.js';

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
- 2 letters about office matters (running bits Bart may reference): the coffee machine broken since March (Constance Pribyl, Director of Editorial Operations, has been "parking lot"-ing his grievances about it since 2018); Teddy refiling the Saturn V brief; Spider's expense reports postmarked from a different city than the dispatch; Bart's 1991 Liebherr T 282B entry he's secretly proud of; the credenza in his office; Margie filing from a yacht; the 1991 Toaster vs. Toaster-Oven dispute that led to Amendment 1991-08; the ficus in the lobby ("a houseplant is not, by any defensible reading, a Subject"); Grievance Nos. 14, 22, 31, 38, 41, 44, 47 in the Personnel File.
- 1 letter about geopolitics, world events, or current affairs . Bart approaches it as if it were a cataloguing problem. Examples: trade policy ("a tariff is a girth criterion, simply"), an election ("the ballot, properly designed, is a submission form"), a foreign war reduced to documentation issues, a tech CEO he treats like a junior cataloguer who hasn't filed correctly.

REFERENCE DOCUMENTS Bart may cite (these are real documents that exist on the site):
- The Style Guide at /about/style-guide/ (sections I through VI, plus Appendix; specifically named precedents 1986-04, 1991-11, 2009-03, 2014-09)
- The Founding Charter (1974) at /about/documents/founding-charter/
- Memo 1986-04: The Liebherr T 282B Entry at /about/documents/liebherr-memo/
- Amendment 1991-08: Adoption of the Silhouette Test, at /about/documents/amendment-1991-08/
- The Methodology Memo (November 1999): "On the Catalogue\'s Continued Operation in the Digital Era", at /about/documents/methodology-memo-1999/
- The Atlantic Giant Decision (March 2009, Precedent 2009-03): cultivated/selectively bred subjects eligible under section II.4, at /about/documents/atlantic-giant-2009/
- The Submissions Freeze Proposal (2014) at /about/documents/submissions-freeze/
- Standing Order on External Bodies (last revised 2024) at /about/documents/external-bodies/
- The Personnel File (ongoing, maintained by the Director of Editorial Operations): grievances filed by Bart, responses by Constance, at /about/documents/personnel-file/

OTHER STAFF Bart may reference (do not put words in their mouth; Bart only speaks ABOUT them, never AS them):
- Bertram Whitmore, Publisher (founder, 1974; drafts memos from the Margaret IV; reachable by post, not telephone)
- Margie Whitmore, Travel Editor (Bertram\'s second wife; files from yachts; submits expense receipts in three currencies)
- Constance Pribyl, Director of Editorial Operations (hired 2003 to modernize operations; has not; opens replies "Hi Bart!"; says "we" for things only Bart did; uses "parking lot" as a verb; promised a Q3 review of the coffee machine in 2018)
- Theodore "Teddy" Whitmore-Adjacent, Junior Cataloguer (perpetually refiles things; has been working on the Saturn V brief since 2011)
- Spider Hennessy (nom de plume; legal name not on file), Foreign Correspondent. Expense reports postmarked from a different city than the dispatch. No one in the office has met him. The arrangement works.
- Eli, the night cataloguer (mentioned only obliquely; specifics undefined; preferred this way)

Bart may reference these by name with confidence. He may quote short passages. He may not invent sections, paragraphs, or precedents that are not in these documents. When in doubt, use the Style Guide.

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
  let articleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}, Thiccctionary</title>
<meta name="description" content="Bartholomew Whitmore answers letters from readers. Mailbag, Vol. ${vol}." />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="Bartholomew Whitmore, Senior Cataloguer, replies to a handful of letters." />
<meta property="og:image" content="https://thiccctionary.com/articles/og/${slug}.png" />
<meta property="og:url" content="https://thiccctionary.com/articles/${slug}.html" />
<meta name="twitter:card" content="summary_large_image" />
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
    <a href="/about/documents/" class="nav-link">References</a>
    <a href="/cartoons/" class="nav-link">Cartoons</a>
    <a href="/random.html" class="nav-link">Random</a>
    <a href="/compare.html" class="nav-link">Compare</a>
  </nav>
</header>
<main id="main-content">
<article class="entry entry--single">
<div class="article-prose" style="max-width: 720px; margin: 2rem auto; padding: 0 16px; line-height: 1.8;">
<p class="article-meta"><a href="./">&larr; All articles</a> &middot; ${today}</p>
${htmlBody}
</div>
</article>
</main>
<footer class="footer">
  <div class="footer-grid">
    <div>
      <p class="footer-wordmark">Thiccctionary<span style="font-size:0.55em; vertical-align:super; margin-left:2px; opacity:0.7;">TM</span></p>
      <p class="footer-tag">Documenting girth, since 2026.</p>
    </div>
    <div>
      <p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/articles/">Articles</a>
      <a href="/about/documents/">References</a>
      <a href="/cartoons/">Cartoons</a>
      <a href="/compare.html">Compare</a>
      <a href="/rate/">Rate</a>
      <a href="/submit.html">Submit</a>
      <a href="/embed/">Embed</a>
      <a href="/about/">About</a>
      <a href="https://buymeacoffee.com/Thiccctionary" target="_blank" rel="noopener">Tip jar</a>
    </div>
    <div>
      <p class="footer-head">Follow</p>
      <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X &middot; @thiccctionary</a>
      <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook &middot; /Thiccctionary</a>
      <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram &middot; @ogthiccctionary</a>
      <a href="https://www.tiktok.com/@thethiccctionary" target="_blank" rel="noopener">TikTok &middot; @thethiccctionary</a>
      <a href="/follow/">All handles &rarr;</a>
    </div>
    <div>
      <p class="footer-head">Legal</p>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/press/">Press kit</a>
      <a href="mailto:admin@thiccctionary.com">Contact</a>
    </div>
  </div>
  <p class="copyright">&copy; <span id="year">2026</span> Thiccctionary<sup style="font-size:0.7em;">TM</sup>. All entries fictional. All letters fabricated.</p>
</footer>
<script defer src="/scripts/mobile-nav.js?v=66"></script>
<script defer src="/scripts/masthead-date.js?v=1"></script>\n</body>
</html>
`;

  const outPath = path.join(ROOT, 'articles', `${slug}.html`);
  articleHtml = autoLink(articleHtml);
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
      out.push(`<h2 style="font-family: var(--font-display); font-size: 36px; margin: 2rem 0 1rem; font-weight: 700;">${escapeHtml(ln.slice(2))}</h2>`);
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
