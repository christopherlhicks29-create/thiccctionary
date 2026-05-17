/**
 * Thiccctionary weekly Field Report generator.
 *
 * Runs every Sunday. Reads the last 7 days of entries, picks a theme that
 * threads through them, and writes a 700-1000 word Field Report essay in
 * the editorial-board voice (anchored on bagger-288 + physics-of-thiccc).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const ARTICLES_PATH = path.join(ROOT, 'data', 'articles.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY not set');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set — generator now uses Claude for voice mimicry');
  process.exit(1);
}

const TARGET_DATE = (process.env.TARGET_DATE || new Date().toISOString().slice(0, 10)).trim();
const THEME_OVERRIDE = (process.env.THEME_OVERRIDE || '').trim();

function isoDateDaysAgo(refIso, days) {
  const d = new Date(refIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function humanDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function pickRecentEntries(entries, targetIso, days = 7) {
  const cutoff = isoDateDaysAgo(targetIso, days);
  return entries.filter(e => e.date && e.date >= cutoff && e.date <= targetIso).sort((a, b) => b.date.localeCompare(a.date));
}

async function callClaude(systemPrompt, messages, model = 'claude-sonnet-4-6') {
  // Anthropic Messages API. Returns JSON parsed from Claude's response.
  // Claude is dramatically better at voice mimicry than gpt-4o, so we use it
  // for the generator path. The critic stays on gpt-4o (cheap binary judgment).
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }
  const data = await res.json();
  let content = data.content?.[0]?.text || '';
  // Strip markdown code fences if Claude added them
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Find the JSON object (Claude sometimes adds preamble)
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude returned no JSON object: ' + content.slice(0, 500));
  return JSON.parse(m[0]);
}

async function callOpenAI(messages, model = 'gpt-4o') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.55 }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`OpenAI ${res.status}: ${text}`); }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const VOICE_NOTES = `You are writing as the editorial board of Thiccctionary, a satirical print-magazine-style publication that catalogs objects of unusual girth. The voice is closer to a 1962 architecture review than to a 2024 listicle. Treat the subject matter with mock gravity — the joke is the tone.

VOICE ANCHORS — study these excerpts from the existing articles. Match their cadence, sentence rhythm, and register. Do not mimic — internalize.

From "The Bagger 288: The Thiccc-est Machine on Earth":

  > There is a particular kind of machine that does not merely perform a function but embodies one. The Bagger 288 digs. This is its purpose. Everything about its form — the sprawling crawler tracks, the 18.5-metre bucket wheel turning at the speed of deliberate inevitability, the counterweight booms stretching backward like the tail of some geological herbivore — exists solely in service of digging. And it digs at a scale that requires new vocabulary.

  > The machine removes 240,000 tonnes of overburden per day. To understand what this means, consider that a standard dump truck carries around 30 tonnes. The Bagger 288 would require 8,000 of them, working around the clock, to match a single day's output. The machine does not work in shifts. It works.

  > Forty-eight years is a long time to hold a title. Most records of this kind have a natural half-life measured in decades, because the pressure to exceed the previous superlative is, in most industries, irresistible. The Bagger 288's record has endured because the engineering problem it was built to solve — extracting lignite at scale — has not produced sufficient demand for a larger machine. It is, in the most literal sense, enough.

  > The editorial board recommends standing approximately one kilometre away and taking a moment.

Patterns to notice:
- Concrete numbers as character beats (240,000 tonnes, 18.5-metre, 8,000 trucks). Never round numbers, never invent them.
- Mock-academic vocabulary used straight-faced: "structural commitment", "the grammar of scale", "by dry mass", "in the most literal sense".
- Short declarative sentences placed strategically against longer architectural ones. "It works." "This is sufficient."
- The editorial board referred to in third person, dryly, occasionally.
- Specificity over abstraction. Always.

HARD RULES:
1. Never break the fourth wall. No "as an AI", no "as a satire", no "this article".
2. Never use modern internet voice. "Absolutely massive", "chonky boi", "literally a unit", "main character energy" are forbidden.
3. Every number you cite must be verifiable from the entries provided or be a well-established public fact. If you can't source it, don't write it.
4. Reference at least 2 recent entries by name. Format: [Entry Word](../entries/YYYY-MM-DD.html). Never write the bare URL in prose.
5. 700-1000 words across 4-6 sections. No section labeled "Conclusion".
6. The piece should make a CLAIM — argue something specific about a category, a property, a tension. Not "explore" or "examine" — claim.`;

const HUMOR_GUARDRAILS = `These patterns are AI tells. Producing them means failure — better to be short than to use them:

BANNED HEADINGS:
- "Conclusion", "Final Thoughts", "Wrapping Up", "In Summary", "Reflections" — all forbidden.
- Headings that are abstract nouns alone ("Resonance", "Harmony", "Power"). Headings must be specific or pose a question.
- GOOD: "The Grammar of Scale", "On Being the Largest", "The Question of Movement", "What the Bagger 288 Teaches Us"

BANNED CLOSERS:
- "And so we continue cataloguing..."
- "As our examinations continue..."
- "Thicccness dwells not just in X but in Y..."
- "Transcends mere physicality..."
- Anything that summarizes the article you just wrote.

GOOD CLOSER: an absurdly specific, concrete, dry observation or instruction. The Bagger 288 article closes with: "The editorial board recommends standing approximately one kilometre away and taking a moment." That's the target.

BANNED METAPHORS — all of these are AI-feature-writer clichés:
- Symphony / harmony / orchestrator / conductor / movement (in the music sense)
- Tapestry / intersection / lattice / weaves through / threads together
- Dance / ballet / choreographed
- Embodies / encapsulates / captures the essence of
- Stands as a testament to / serves as a reminder that
- Dwells / resides / makes its home
- Forces of nature / quiet power

BANNED PHRASES:
- "Not just X, but Y" (use ONCE max in entire article)
- "It is X. It is Y. It is Z." (three-clause rhythm — feels generated)
- "Perhaps", "arguably", "in a sense", "in essence" — use ONCE max total
- "Captures" any abstract noun (captures the essence, captures the imagination, captures the weight)

LINK STYLE: Reference recent entries with markdown links: [Bagger 288](../entries/2026-05-10.html). Never write a bare /entries/... URL. Anchor text is the entry's word, not the date.

CADENCE: Vary sentence length. Long-long-long is monotonous. Short-short-short is mechanical. Mix.

THE TEST: Read your draft aloud in the voice of a 1962 magazine editor. If it sounds like a 2024 blogger, rewrite.`;

function buildSystemPrompt() {
  return `You are the Thiccctionary editorial board, writing a weekly Field Report essay.

${VOICE_NOTES}

${HUMOR_GUARDRAILS}

Return ONLY JSON:
{
  "slug": "kebab-case-slug",
  "title": "Article title (≤70 chars).",
  "kicker": "Short eyebrow text (e.g. 'From the Editorial Board · Field Report')",
  "dek": "One-sentence italic standfirst, 25-50 words. Sets the angle.",
  "description": "Meta description, 140-160 chars.",
  "sections": [ { "heading": "H3 heading", "paragraphs": ["Para 1", "Para 2"] } ],
  "related_entry": { "slug": "YYYY-MM-DD of the most-related entry", "word": "The word from that entry" },
  "hero_entry_slug": "YYYY-MM-DD of the entry whose image is the hero"
}

- Paragraph text is plain. Surround words with *asterisks* for italics. Write "thiccc" plain — renderer wraps the triple-c.
- No HTML tags in content. JSON only.
- 4-6 sections. 700-1000 words across all paragraphs combined.
- Reference recent entries by name and link them as /entries/<slug>.html.`;
}

function buildUserPrompt(recentEntries, pastArticleTitles) {
  const entriesBlock = recentEntries.map(e => `- ${e.date} · "${e.word}" — ${(e.definition || '').slice(0, 280)}`).join('\n');
  const pastBlock = pastArticleTitles.slice(0, 20).map(t => `- ${t}`).join('\n');
  const themeLine = THEME_OVERRIDE ? `\nTHEME OVERRIDE: ${THEME_OVERRIDE}\n` : '';
  return `Write this week's Field Report. Today is ${humanDate(TARGET_DATE)}.

ENTRIES PUBLISHED IN THE PAST 7 DAYS (at least 2 must be referenced and linked):
${entriesBlock}

ARTICLES ALREADY PUBLISHED (don't duplicate these angles):
${pastBlock}
${themeLine}
Find a theme that threads through the recent entries — a property, a category, a question, a tension. Build the essay around that theme.

Return the JSON only.`;
}

function wrapThiccc(text) {
  return text.replace(/(?<!class="ccc">)thi(ccc)/gi, (m) => {
    const upper = m[0] === 'T';
    return (upper ? 'Thi' : 'thi') + '<span class="ccc">ccc</span>';
  });
}

function emFromAsterisks(text) {
  return text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function linkifyEntries(text, entryWordByDate = {}) {
  // Step 1: replace markdown links [text](../entries/YYYY-MM-DD.html) → anchor with a SENTINEL host
  // so step 2's bare-URL regex won't re-match the URL we just placed inside an href.
  const SENT = '__ENTRY_DONE__';
  text = text.replace(/\[([^\]]+)\]\(\.\.\/entries\/(\d{4}-\d{2}-\d{2})\.html\)/g, (_, label, d) => `<a href="${SENT}${d}.html">${label}</a>`);
  // Step 2: convert remaining bare /entries/YYYY-MM-DD.html mentions to anchors.
  text = text.replace(/\.\.\/entries\/(\d{4}-\d{2}-\d{2})\.html/g, (_, d) => {
    const word = entryWordByDate[d] || d;
    return `<a href="../entries/${d}.html">${word}</a>`;
  });
  // Step 3: restore the sentinel back to the real URL.
  text = text.split(SENT).join('../entries/');
  return text;
}

function renderArticleHtml({ slug, title, kicker, dek, sections, description, related_entry, publishedIso, heroImagePath, heroImageCredit, entryWordByDate }) {
  const titleHtml = title.replace(/thiccc/gi, m => (m[0] === 'T' ? 'Thi' : 'thi') + '<span class="ccc">ccc</span>');
  const titlePlain = title.replace(/thiccc/gi, 'thiccc');
  const dekHtml = wrapThiccc(emFromAsterisks(dek));
  const sectionsHtml = sections.map(s => {
    const heading = wrapThiccc(s.heading);
    const paras = s.paragraphs.map(p => `<p>${wrapThiccc(emFromAsterisks(linkifyEntries(p, entryWordByDate)))}</p>`).join('\n\n');
    return `<h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 2rem 0 0.75rem;">${heading}</h3>\n\n${paras}`;
  }).join('\n\n');
  const pretty = humanDate(publishedIso);
  const heroFigure = heroImagePath ? `
<figure style="margin: 0 0 2.5rem; border: 1px solid var(--rule);">
<img src="${heroImagePath}" alt="${titlePlain}" style="width: 100%; display: block;" loading="eager" />
${heroImageCredit ? `<figcaption style="font-family: var(--font-mono); font-size: 11px; padding: 0.75rem 1rem; color: var(--ink-soft); border-top: 1px solid var(--rule);">${heroImageCredit}</figcaption>` : ''}
</figure>` : '';
  const relatedBlock = related_entry?.slug ? `
<aside style="margin: 3rem 0 2rem; padding: 1.5rem; border: 1px solid var(--rule); border-left: 4px solid var(--oxblood); background: rgba(139,31,31,0.03);">
<p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 0.5rem;">Related Entry</p>
<p style="margin: 0;"><a href="../entries/${related_entry.slug}.html" style="color: var(--oxblood); font-weight: 600; border-bottom: 1px solid var(--oxblood); text-decoration: none;">${related_entry.word}</a> — the full Thi<span class="ccc">ccc</span>tionary definition.</p>
</aside>` : '';
  const ogImg = heroImagePath ? 'https://thiccctionary.com' + heroImagePath.replace('../', '/') : 'https://thiccctionary.com/og-default.png';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${titlePlain} — Thiccctionary</title>
<meta name="description" content="${description}" />
<link rel="icon" type="image/svg+xml" href="../favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="canonical" href="https://thiccctionary.com/articles/${slug}.html" />
<meta name="theme-color" content="#f5e8c7" />
<meta property="og:locale" content="en_US" />
<meta property="og:site_name" content="Thiccctionary" />
<meta property="og:title" content="${titlePlain}" />
<meta property="og:description" content="${description}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="https://thiccctionary.com/articles/${slug}.html" />
<meta property="og:image" content="${ogImg}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${titlePlain}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${ogImg}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.css?v=63" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${titlePlain.replace(/"/g, '\\"')}",
  "description": "${description.replace(/"/g, '\\"')}",
  "image": "${ogImg}",
  "datePublished": "${publishedIso}",
  "author": { "@type": "Organization", "name": "Thiccctionary" },
  "publisher": { "@id": "https://thiccctionary.com/#organization" },
  "url": "https://thiccctionary.com/articles/${slug}.html"
}
</script>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>
<header class="masthead">
<div class="masthead-top">
<span class="meta-line">An Article</span>
    <span class="meta-line meta-line--right">${pretty}</span>
</div>
<h1 class="wordmark" aria-label="Thiccctionary">
<a href="/" class="wordmark-link" aria-label="Thiccctionary — home">
<span class="wordmark-the">The</span>
<span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
</a>
</h1>
<nav class="nav">
<a href="../index.html" class="nav-link">Today's Entry</a>
<a href="../archive.html" class="nav-link">The Archive</a>
<a href="../a-z.html" class="nav-link">A–Z</a>
<a href="../articles/" class="nav-link nav-link--active">Articles</a>
<a href="../random.html" class="nav-link">Random</a>
<a href="../compare.html" class="nav-link">Compare</a>
<a href="../rate/" class="nav-link">Rate</a>
<a href="../api/" class="nav-link">API</a>
<a href="../submit.html" class="nav-link">Submit a Thiccc</a>
<a href="../index.html#about" class="nav-link">About</a>
</nav>
</header>

<main id="main-content">
<a href="../articles/" class="entry-back">← Back to articles</a>

<article class="article-body" style="max-width: 680px; margin: 0 auto; padding: 2rem 1rem 4rem;">

<header class="article-header" style="margin-bottom: 2.5rem;">
<p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 0.75rem;">${kicker}</p>
<h2 style="font-family: var(--font-display); font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 800; line-height: 1.1; margin: 0 0 1rem;">${titleHtml}</h2>
<p style="font-style: italic; font-size: 1.05rem; color: var(--ink-soft); margin: 0;">${dekHtml}</p>
<p class="article-date" style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--ink-soft); margin: 1rem 0 0; padding-top: 0.75rem; border-top: 1px solid var(--rule);"><time datetime="${publishedIso}">Published ${pretty}</time></p>
</header>
${heroFigure}
<div class="article-prose" style="font-size: 1.05rem; line-height: 1.75;">

${sectionsHtml}

</div>
${relatedBlock}
<section class="entry-subscribe" style="margin-top: 3rem;">
<p class="entry-subscribe-eyebrow">A new entry every morning. Get it delivered.</p>
<form class="entry-subscribe-form" action="https://buttondown.email/api/emails/embed-subscribe/thiccctionary" method="post" target="popupwindow" onsubmit="window.open('https://buttondown.email/thiccctionary', 'popupwindow')">
<input type="email" name="email" placeholder="your@email.com" required aria-label="Email address" />
<button type="submit">Subscribe</button>
</form>
</section>

</article>
</main>

<footer class="site-footer">
<p class="copyright">&copy; <span id="year">${new Date().getUTCFullYear()}</span> Thiccctionary. All entries fictional. All proportions exaggerated for comedic effect.</p>
</footer>
<script src="../scripts/mobile-nav.js" defer></script>
</body>
</html>
`;
}



const BANNED_PHRASES = [
  /\bembod(y|ies|ied|ying)\b/i,
  /\bencaps(u|o)l(a|i)t(e|es|ed|ing)\b/i,
  /\bintersect(ion|s|ing)?\b/i,
  /\btranscend(s|ed|ing|ence)?\b/i,
  /\btapestr(y|ies)\b/i,
  /\b(symphony|harmon(y|ies)|orchestrat(or|ing|ed))\b/i,
  /\b(weaves|woven|threads through)\b/i,
  /\bdance(s|d|ing)?\b/i,
  /\bchoreograph(y|ed|ing)\b/i,
  /\b(captures|captures the essence)\b/i,
  /\b(stands as a testament|serves as a reminder|speaks to)\b/i,
  /\b(dwells|resides|makes its home)\b/i,
  /\bresonating force\b/i,
  /\bquiet power\b/i,
  /\binvites engagement\b/i,
  /\bsonic signature\b/i,
  /\bauditory realm\b/i,
  /\bauditory reflection\b/i,
  /\bdemand(s|ing)? recognition\b/i,
];

function preFilterDraft(article) {
  const text = [
    article.title || '',
    article.dek || '',
    ...(article.sections || []).flatMap(sec => [sec.heading, ...(sec.paragraphs || [])]),
  ].join('\n');
  const hits = [];
  for (const re of BANNED_PHRASES) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  // Also: bare /entries/ URLs (not inside markdown link or anchor tag)
  const bareUrl = text.match(/(?<!\]\()\.\.\/entries\/\d{4}-\d{2}-\d{2}\.html(?!\))/);
  if (bareUrl) hits.push('bare entry URL: ' + bareUrl[0]);
  return hits;
}

async function critiqueDraft(article) {
  const fullText = [
    article.title || '',
    article.dek || '',
    ...(article.sections || []).flatMap(sec => [sec.heading, ...(sec.paragraphs || [])]),
  ].join('\n\n');

  const systemMsg = `You are the senior editor reviewing a Field Report draft for Thiccctionary. You hold the bar high. Anything B-minus gets rejected.

Score the draft against these explicit failure modes. Return JSON:
{
  "verdict": "pass" or "fail",
  "score": 0-10 (only 8+ is "pass"),
  "issues": ["specific issue 1", "specific issue 2", ...]
}

FAIL THE DRAFT if any of these are present:
- Heading labeled "Conclusion", "Final Thoughts", "In Summary", "Reflections", or any synonym
- Heading that is a single abstract noun ("Resonance", "Harmony", "Power")
- Closer that summarizes or uses "we continue", "dwells", "transcends", "as our examinations"
- Any banned metaphor: symphony, harmony, orchestrator, tapestry, intersection, dance, embodies, encapsulates, captures the essence
- "Stands as a testament", "serves as a reminder", "speaks to"
- "Not just X, but Y" used more than once
- Three-short-clause rhythm in any paragraph
- "Perhaps" / "arguably" / "in a sense" used more than once total
- Bare /entries/... URL in prose (must be markdown link with entry word as anchor)
- Section count outside 4-6
- Word count outside 700-1000
- Any fabricated-sounding number (very round, oddly specific without source feel)
- Modern internet voice creeping in
- Title that's abstract and generic ("Sound and Power", "The Thiccc Harmony")

ALLOWED PATTERNS (do NOT flag these — they are the canonical voice anchors):
- "The editorial board recommends" / "the editorial board notes" — this IS the voice (see Bagger 288)
- Mock-academic phrasings like "in the most literal sense", "by dry mass", "structural commitment"
- Specific dry instructions to the reader as closers (e.g. "Stand approximately one kilometre away")
- Italicized words for emphasis (rendered as *word* in source)
- Em-dashes used sparingly for timing
- "Field report" / "editorial" framings
- Citing concrete numbers from real engineering facts

PASS only if the draft has the dry, mock-academic register of the Bagger 288 sample and contains zero banned patterns.

Be a tough editor, but be ACCURATE. Quote the exact offending phrase when flagging an issue. If you claim a metaphor is present, quote the sentence containing it. Do not hallucinate failures — every issue must cite a verbatim string from the draft.

The cost of a bad article publishing is high. The cost of one extra rewrite is low. But the cost of falsely failing a good draft and shipping nothing is also high — be precise.`;

  const userMsg = `DRAFT TO REVIEW:\n\n${fullText}\n\nReturn JSON only.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`critique OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  console.log(`[weekly] target date: ${TARGET_DATE}`);
  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  const articles = JSON.parse(await fs.readFile(ARTICLES_PATH, 'utf8'));
  const recent = pickRecentEntries(entries, TARGET_DATE, 7);
  if (recent.length < 3) {
    console.error(`FATAL: only ${recent.length} entries in past 7 days — need at least 3`);
    process.exit(1);
  }
  console.log(`[weekly] ${recent.length} recent entries: ${recent.map(e => e.word).join(', ')}`);
  const pastTitles = articles.map(a => a.title);
  console.log('[weekly] calling Claude (draft 1)…');
  let article = await callClaude(
    buildSystemPrompt(),
    [{ role: 'user', content: buildUserPrompt(recent, pastTitles) }]
  );

  // Self-critique loop: regex pre-filter first (cheap, deterministic), then critic.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const banHits = preFilterDraft(article);
    if (banHits.length > 0) {
      console.log(`[weekly] pre-filter pass ${attempt} hit banned phrases: ${banHits.join(', ')}`);
      if (attempt === 4) {
        console.error('[weekly] FAILED pre-filter after 4 attempts — exiting non-zero');
        process.exit(1);
      }
      console.log(`[weekly] rewriting (pre-filter fail, draft ${attempt + 1})…`);
      article = await callClaude(buildSystemPrompt(), [
        { role: 'user', content: buildUserPrompt(recent, pastTitles) },
        { role: 'assistant', content: JSON.stringify(article) },
        { role: 'user', content: `Your last draft used these BANNED phrases verbatim — strip them and any related phrasing, then return a complete new JSON article:\n${banHits.map(p => '  - "' + p + '"').join('\n')}` },
      ]);
      continue;
    }
    const critique = await critiqueDraft(article);
    console.log(`[weekly] critique pass ${attempt} verdict: ${critique.verdict} (score ${critique.score}/10)`);
    if (critique.verdict === 'pass') break;
    console.log(`[weekly] issues: ${critique.issues.join(' | ')}`);
    if (attempt === 4) {
      console.error('[weekly] FAILED quality bar after 2 attempts — exiting non-zero');
      console.error(JSON.stringify(critique, null, 2));
      process.exit(1);
    }
    console.log(`[weekly] rewriting via Claude (draft ${attempt + 1})…`);
    article = await callClaude(buildSystemPrompt(), [
      { role: 'user', content: buildUserPrompt(recent, pastTitles) },
      { role: 'assistant', content: JSON.stringify(article) },
      { role: 'user', content: `Your last draft failed the editorial review. Fix these issues and return a complete new JSON article with ALL banned patterns removed:\n\n${critique.issues.map(i => '- ' + i).join('\n')}\n\nReturn the corrected JSON only.` },
    ]);
  }
  for (const field of ['slug', 'title', 'kicker', 'dek', 'description', 'sections']) {
    if (!article[field]) throw new Error(`OpenAI response missing field: ${field}`);
  }
  if (!Array.isArray(article.sections) || article.sections.length < 3) {
    throw new Error(`OpenAI returned ${article.sections?.length || 0} sections — need ≥3`);
  }
  const existingSlugs = new Set(articles.map(a => a.slug));
  let slug = slugify(article.slug);
  while (existingSlugs.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
  article.slug = slug;
  let heroImagePath = null;
  let heroImageCredit = null;
  const heroEntryDate = article.hero_entry_slug || article.related_entry?.slug;
  if (heroEntryDate) {
    const heroEntry = entries.find(e => e.date === heroEntryDate);
    if (heroEntry?.image) {
      const imgPath = heroEntry.image.startsWith('http') ? heroEntry.image : '..' + (heroEntry.image.startsWith('/') ? heroEntry.image : '/' + heroEntry.image);
      heroImagePath = imgPath;
      if (heroEntry.photographer && heroEntry.photographerUrl) {
        heroImageCredit = `Photo by <a href="${heroEntry.photographerUrl}" target="_blank" rel="noopener">${heroEntry.photographer}</a> on <a href="https://unsplash.com/?utm_source=thiccctionary&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>.`;
      }
    }
  }
  const entryWordByDate = {};
  for (const e of entries) {
    if (e.date && e.word) entryWordByDate[e.date] = e.word;
  }
  const html = renderArticleHtml({
    slug: article.slug, title: article.title, kicker: article.kicker, dek: article.dek,
    sections: article.sections, description: article.description, related_entry: article.related_entry,
    publishedIso: TARGET_DATE, heroImagePath, heroImageCredit, entryWordByDate,
  });
  const outPath = path.join(ARTICLES_DIR, `${article.slug}.html`);
  await fs.writeFile(outPath, html, 'utf8');
  console.log(`[weekly] wrote ${outPath}`);
  articles.unshift({
    slug: article.slug,
    title: article.title.replace(/thi<span[^>]*>ccc<\/span>/gi, 'thiccc'),
    description: article.description,
    date: TARGET_DATE,
  });
  await fs.writeFile(ARTICLES_PATH, JSON.stringify(articles, null, 2) + '\n', 'utf8');
  console.log(`[weekly] updated data/articles.json`);
  execSync('node ' + path.join(__dirname, 'regenerate-article-listings.js'), { stdio: 'inherit', cwd: ROOT });
  console.log(`\n[weekly] DONE.`);
  console.log(`  Title: ${article.title}`);
  console.log(`  Slug:  ${article.slug}`);
  console.log(`  Path:  articles/${article.slug}.html`);
}

main().catch(err => {
  console.error('[weekly] FATAL:', err);
  process.exit(1);
});
