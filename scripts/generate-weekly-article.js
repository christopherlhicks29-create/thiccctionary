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
if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY not set');
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

async function callOpenAI(messages, model = 'gpt-4o') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.85 }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`OpenAI ${res.status}: ${text}`); }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const VOICE_NOTES = `Field Report voice — anchored on existing articles:

1. Bagger 288: opens with declarative grounding. Uses concrete numbers as character beats. Refers to the Thiccctionary editorial board in third person. Closes with a small dry instruction.

2. Physics of Thiccc: argues from physical law (square-cube). Treats "thiccc" as a technical category requiring structural commitment, not just size. Uses em-dashes for timing. Light irony, never winking.

Rules:
- Never break the fourth wall ("as an AI" or "as a satire" is forbidden).
- Never use modern internet voice ("absolutely massive", "literally a unit", "chonky boi"). The voice is closer to a 1962 architecture review than a meme caption.
- Concrete numbers carry weight. Don't fabricate figures — only cite things from the entries provided or well-established public facts.
- 700-1000 words across 4-6 body sections.
- Reference at least 2 of the recent entries by name with linkable slug.`;

const HUMOR_GUARDRAILS = `Avoid these AI tells:
- Three-short-clause strings ("It is heavy. It is wide. It is thiccc.")
- "Not just X, but Y" used more than once.
- Aspirational closer ("And so we continue cataloguing..."). End on something concrete or dryly observational.
- Hedging adjectives ("perhaps", "arguably") more than once.
- Em-dash overuse — at most one per paragraph.`;

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

function linkifyEntries(text) {
  return text.replace(/\/entries\/(\d{4}-\d{2}-\d{2})\.html/g, '<a href="../entries/$1.html">/entries/$1.html</a>');
}

function renderArticleHtml({ slug, title, kicker, dek, sections, description, related_entry, publishedIso, heroImagePath, heroImageCredit }) {
  const titleHtml = title.replace(/thiccc/gi, m => (m[0] === 'T' ? 'Thi' : 'thi') + '<span class="ccc">ccc</span>');
  const titlePlain = title.replace(/thiccc/gi, 'thiccc');
  const dekHtml = wrapThiccc(emFromAsterisks(dek));
  const sectionsHtml = sections.map(s => {
    const heading = wrapThiccc(s.heading);
    const paras = s.paragraphs.map(p => `<p>${wrapThiccc(emFromAsterisks(linkifyEntries(p)))}</p>`).join('\n\n');
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
  console.log('[weekly] calling OpenAI…');
  const article = await callOpenAI([
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(recent, pastTitles) },
  ]);
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
  const html = renderArticleHtml({
    slug: article.slug, title: article.title, kicker: article.kicker, dek: article.dek,
    sections: article.sections, description: article.description, related_entry: article.related_entry,
    publishedIso: TARGET_DATE, heroImagePath, heroImageCredit,
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
