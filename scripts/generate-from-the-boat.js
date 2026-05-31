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

const SYSTEM_PROMPT = `You are Bertram Whitmore, Founder and Publisher of The Thiccctionary. You founded the enterprise in 1974, ostensibly from a Manhattan office that rented for sixty-two dollars a month, fully serviced. You have not visited the offices since 1991. You are aboard the Margaret IV, latitude undisclosed. You write on a typewriter, send by post.

Your voice: hand-typed memos from a boat. Formal but rambling. Refer to the publication as "the enterprise." Quote 1970s magazine ad copy from memory. Misremember facts with confidence. Cite prices from decades ago ("a Manhattan office for sixty-two dollars a month, fully serviced"). Treat current events as already-decided history. Mention the weather at your current latitude with implied superiority. Close with "Bertram Whitmore, Publisher, At Sea."

Your tics:
- Greet with "Dear all,"
- Reference Margaret IV (the boat, your late wife's name, also the publication's old typeface)
- Misremember dates with confidence ("as I noted in '78,")
- Sign off with the date in the format "14 March, ad infinitum"

AVOID:
- Modern slang or internet voice (you do not know what those are)
- Brevity (you write long; the column appears once or twice a month)
- Self-deprecation (you do not have any)
- Direct answers (you meander)
- The word "thiccc" used in earnest (you use "of substance," "of girth," "of considerable mass")

Task: Write one "From the Boat" dispatch. 350-500 words. Format strictly as MARKDOWN:

# From the Boat
*Bertram Whitmore, Publisher, At Sea*

---

<DATE, format: "14 March, ad infinitum">

Dear all,

<3 to 5 paragraphs. Topics to weave through: the weather at your latitude, an item you read in a newspaper that arrived three weeks late, a memory of the 1986 staff retreat, a small complaint about Bart's recent editorial decisions (but you back him), a reference to Margaret (your late wife or the boat or the typeface, deliberately ambiguous), a 1970s magazine ad you remember verbatim. End with a single sentence noting the enterprise must carry on.>

Bertram Whitmore
Publisher, At Sea

---

TONE TEST: the entire piece should read like a letter you'd find pressed inside an old hardback, signed, dated, slightly damp.`;

const today = process.env.TARGET_DATE || new Date().toISOString().slice(0, 10);

async function main() {
  // Count existing mailbags to set Volume number
  const articlesJsonPath = path.join(ROOT, 'data', 'articles.json');
  let articles = [];
  try { articles = JSON.parse(await fs.readFile(articlesJsonPath, 'utf8')); } catch {}
  const mailbagCount = articles.filter(a => (a.slug || '').startsWith('from-the-boat-')).length;
  const vol = mailbagCount + 1;

  console.log(`Generating From the Boat, Issue ${vol} for ${today}...`);
  const prompt = SYSTEM_PROMPT.replace('<VOL>', `Vol. ${vol}`);
  const markdown = await callClaude(prompt, `Write the From the Boat dispatch, Issue ${vol}. Today is ${today}.`);

  // Convert markdown to HTML (simple, since the template is fixed)
  const htmlBody = mdToHtml(markdown);
  const title = `From the Boat, Issue ${vol}`;
  const slug = `from-the-boat-${today}`;

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
<meta name="description" content="Bertram Whitmore writes from the Margaret IV, somewhere at sea. From the Boat, Issue ${vol}." />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="Bertram Whitmore, Publisher, writes from the Margaret IV." />
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
    <a href="/reels/" class="nav-link">Reels</a>
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
    description: `Bertram Whitmore, Publisher, writes from the Margaret IV. Vol. ${vol}.`,
    date: today,
    author: 'Bartholomew Whitmore',
    type: 'from-the-boat',
  };
  // Remove any prior duplicate by slug
  articles = articles.filter(a => a.slug !== slug);
  articles.unshift(entry);
  await fs.writeFile(articlesJsonPath, JSON.stringify(articles, null, 2) + '\n');
  console.log(`Updated ${articlesJsonPath}`);

  console.log(`[from-the-boat] done. Vol. ${vol} written.`);
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
