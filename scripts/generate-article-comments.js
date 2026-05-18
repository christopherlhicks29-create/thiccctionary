/**
 * Generate in-character comments on an article by 1-3 other staff members.
 *
 * Reads:
 *   - data/articles.json  (find article by slug → find author byline_id)
 *   - articles/<slug>.html (pull title + dek for context)
 *   - data/editorial-staff.json
 *
 * Writes:
 *   - data/article-comments.json (appends comments for this slug)
 *
 * Env:
 *   ARTICLE_SLUG     — required, slug of the article to comment on
 *   ANTHROPIC_API_KEY — required
 *   OPENAI_API_KEY    — required (for the rater)
 *   MAX_COMMENTS      — optional, default 3
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { contextFor as bibleContextFor } from './lib/office-bible.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ARTICLE_SLUG = (process.env.ARTICLE_SLUG || '').trim();
const ARTICLE_SLUGS = (process.env.ARTICLE_SLUGS || '').trim();
if (!ARTICLE_SLUG && !ARTICLE_SLUGS) { console.error('FATAL: ARTICLE_SLUG or ARTICLE_SLUGS required'); process.exit(1); }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY missing'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('FATAL: OPENAI_API_KEY missing'); process.exit(1); }

const MAX_COMMENTS = parseInt(process.env.MAX_COMMENTS || '3', 10);
const MIN_COMMENTS = 1;
const COMMENT_MAX_CHARS = 220;
const QUALITY_THRESHOLD = 7;

async function callClaude(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system, messages: [{ role: 'user', content: user }], temperature: 0.85 }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim().replace(/^["']+|["']+$/g, '');
}

async function callOpenAI(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o', messages, response_format: { type: 'json_object' }, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

function extractArticleContext(html) {
  // Pull title, dek, and a snippet of the body
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const dekMatch = html.match(/<p style="font-style: italic[^"]*">(.*?)<\/p>/);
  const proseMatch = html.match(/<div class="article-prose"[^>]*>([\s\S]*?)<\/div>/);
  let snippet = '';
  if (proseMatch) {
    const text = proseMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    snippet = text.slice(0, 600);
  }
  return {
    title: (titleMatch?.[1] || '').replace(/, Thiccctionary$/, '').trim(),
    dek: (dekMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
    snippet,
  };
}

async function generateComment(commenter, author, article, alreadyMade, bibleContext = '') {
  const system = `You are ${commenter.name}, ${commenter.title} at Thiccctionary.

VOICE: ${commenter.voice}

YOUR OBSESSIONS: ${(commenter.obsessions || []).join('; ')}

WORKPLACE DYNAMICS YOU LEAN INTO:
${(commenter.drama_hooks || []).map(h => '- ' + h).join('\n')}

WRITING TICS:
${(commenter.tics || []).map(t => '- ' + t).join('\n')}
${bibleContext ? '\n' + bibleContext + '\n' : ''}

You are leaving a SHORT comment on a colleague's article. Hard rules:
- LESS THAN OR EQUAL TO ${COMMENT_MAX_CHARS} characters total
- React to the article in YOUR voice (mock, agree, footnote, gently dispute, file a formal objection, etc, whatever fits your dynamic with the author)
- Be funny. The inter-staff dynamic is FLAVOR, not the load-bearing joke. The joke must land for a reader who has never heard of any of the staff. Strip the names mentally and check if the comment is still funny.
- Conversational tone, punchy clauses. NOT essay narration.
- No em-dashes (commas, periods, colons, parens)
- No banned phrases: embodies, transcends, intersection, tapestry, symphony, captures the essence, stands as a testament, "not just X, but Y"
- Do NOT sign the comment, the byline is shown separately by the renderer
- Output the comment text only, no preamble, no quote marks`;

  const otherCommentsBlock = alreadyMade.length
    ? `\n\nOTHER STAFF HAVE ALREADY COMMENTED (don't repeat their angles):\n${alreadyMade.map(c => `- ${c.byline_id}: "${c.text}"`).join('\n')}`
    : '';

  const user = `Article you are commenting on:

AUTHOR: ${author.name} (${author.title})
TITLE: ${article.title}
DEK: ${article.dek}
EXCERPT: ${article.snippet}${otherCommentsBlock}

Leave a short comment in your character. Less than ${COMMENT_MAX_CHARS} chars.`;

  let text = await callClaude(system, user);
  text = text.replace(/ — /g, ', ').replace(/ —/g, ',').replace(/— /g, '').replace(/—/g, ', ');
  if (text.length > COMMENT_MAX_CHARS + 10) text = text.slice(0, COMMENT_MAX_CHARS);
  return text;
}

async function rateComment(text, commenter, author) {
  const sys = `Rate this comment on a 0-10 scale for HUMOR + VOICE + SHAREABILITY. Return JSON {"score": int, "verdict": "publish" or "reject", "reasons": [...]}. Publish requires score >= ${QUALITY_THRESHOLD}.

Reject if: em-dashes, banned metaphors (embodies/transcends/tapestry/symphony/intersection/captures), modern internet voice, generic, or doesn't match the commenter's known voice.`;
  const user = `COMMENTER: ${commenter.name} (${commenter.title})
RESPONDING TO: ${author.name} article
COMMENT: """${text}"""

Rate.`;
  return await callOpenAI([{ role: 'system', content: sys }, { role: 'user', content: user }]);
}

async function main() {
  const ARTICLE_SLUG = (process.env.ARTICLE_SLUG || '').trim();
  console.log(`[comments] generating for ${ARTICLE_SLUG}`);

  // Load article metadata
  const articles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'articles.json'), 'utf8'));
  const articleMeta = articles.find(a => a.slug === ARTICLE_SLUG);
  if (!articleMeta) {
    console.error(`Article not found: ${ARTICLE_SLUG}`);
    process.exit(1);
  }
  const authorId = articleMeta.byline_id;
  if (!authorId) {
    console.log(`Article has no byline_id (older legacy article), skipping comment generation`);
    process.exit(0);
  }

  // Load article HTML for context
  const htmlPath = path.join(ROOT, 'articles', `${ARTICLE_SLUG}.html`);
  const html = await fs.readFile(htmlPath, 'utf8');
  const article = extractArticleContext(html);
  article.title = articleMeta.title;

  // Load staff
  const staffData = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'editorial-staff.json'), 'utf8'));
  const author = staffData.staff.find(s => s.id === authorId);
  if (!author) { console.error(`Author byline ${authorId} not in staff bible`); process.exit(1); }

  // Wave 161: anchor-pair guarantee.
  // The Eli <-> Bart axis is the brand's central dynamic. If one of them
  // writes, the OTHER is ALWAYS in the commenter list - no random skip.
  // Saturn V feud, functional-girth debates, etc. depend on this.
  const ANCHOR_PAIR = ['eli', 'bart'];
  const otherStaff = staffData.staff.filter(s => s.id !== authorId);
  let commenters = [];
  if (ANCHOR_PAIR.includes(authorId)) {
    const counterpart = ANCHOR_PAIR.find(id => id !== authorId);
    const counterpartStaff = otherStaff.find(s => s.id === counterpart);
    if (counterpartStaff) commenters.push(counterpartStaff);
  }
  const remainingPool = otherStaff.filter(s => !commenters.find(c => c.id === s.id));
  const targetCount = Math.min(MAX_COMMENTS, Math.max(MIN_COMMENTS, Math.floor(Math.random() * MAX_COMMENTS) + 1));
  const stillNeeded = Math.max(0, targetCount - commenters.length);
  const shuffled = [...remainingPool].sort(() => Math.random() - 0.5);
  commenters = [...commenters, ...shuffled.slice(0, stillNeeded)];
  console.log(`[comments] author=${author.id}, commenters=${commenters.map(c => c.id).join(', ')}${ANCHOR_PAIR.includes(authorId) ? ' (anchor-pair guaranteed)' : ''}`);

  // Load existing comments
  const commentsPath = path.join(ROOT, 'data', 'article-comments.json');
  const commentsData = JSON.parse(await fs.readFile(commentsPath, 'utf8'));
  if (!commentsData.comments[ARTICLE_SLUG]) commentsData.comments[ARTICLE_SLUG] = [];
  // Wave 150: defensive copy. If we just held the reference, the push() below
  // would mutate `existing` and cause [...existing, ...finalComments] downstream
  // to double-count finalComments (root cause of duplicate Teddy comment on
  // the-case-for-functional-girth article).
  const existing = [...commentsData.comments[ARTICLE_SLUG]];

  // Generate
  const finalComments = [];
  for (const commenter of commenters) {
    let bestText = null, bestScore = 0, bestReasons = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const bibleContext = await bibleContextFor(commenter.id, author.id);
      const text = await generateComment(commenter, author, article, [...existing, ...finalComments], bibleContext);
      const rating = await rateComment(text, commenter, author);
      // Wave 161: anchor pair gets a lower quality bar. A short pointed
      // objection from Bart ("I am filing an objection.") naturally scores
      // 5-6 by the rater but reads RIGHT for the brand and the dynamic.
      // Holding them to the full 7/10 was silently dropping the most
      // canonical beats.
      const threshold = (ANCHOR_PAIR.includes(commenter.id) && ANCHOR_PAIR.includes(authorId)) ? 5 : QUALITY_THRESHOLD;
      console.log(`  ${commenter.id} attempt ${attempt}: score ${rating.score}/${threshold}`);
      if (rating.score > bestScore) { bestText = text; bestScore = rating.score; bestReasons = rating.reasons || []; }
      if (bestScore >= threshold) break;
    }
    const finalThreshold = (ANCHOR_PAIR.includes(commenter.id) && ANCHOR_PAIR.includes(authorId)) ? 5 : QUALITY_THRESHOLD;
    if (bestScore >= finalThreshold) {
      finalComments.push({
        byline_id: commenter.id,
        byline_name: commenter.name,
        byline_title: commenter.title,
        text: bestText,
        score: bestScore,
        created: new Date().toISOString(),
      });
      console.log(`  → kept (${bestScore}/10): ${bestText.slice(0, 80)}…`);
    } else {
      console.log(`  → skipped (${bestScore}/${QUALITY_THRESHOLD})`);
    }
  }

  // Append + write
  commentsData.comments[ARTICLE_SLUG].push(...finalComments);
  await fs.writeFile(commentsPath, JSON.stringify(commentsData, null, 2) + '\n', 'utf8');
  console.log(`\n[comments] wrote ${finalComments.length} comments to ${commentsPath}`);

  // Re-render the article HTML with the new comments injected
  await renderCommentsIntoArticle(ARTICLE_SLUG, [...existing, ...finalComments]);
  console.log(`[comments] rendered into ${ARTICLE_SLUG}.html`);
}

async function renderCommentsIntoArticle(slug, allComments) {
  if (allComments.length === 0) return;
  const htmlPath = path.join(ROOT, 'articles', `${slug}.html`);
  let html = await fs.readFile(htmlPath, 'utf8');

  // Wave 150: dedup safety net. Drop any comment whose (byline_id + text) was
  // already seen earlier in the list. Stops double-render no matter how the
  // caller built the array.
  const seenKeys = new Set();
  const deduped = [];
  for (const c of allComments) {
    const key = `${c.byline_id}::${(c.text || '').trim()}`;
    if (seenKeys.has(key)) {
      console.warn(`[comments] dropping duplicate comment from ${c.byline_id}: ${(c.text || '').slice(0, 60)}...`);
      continue;
    }
    seenKeys.add(key);
    deduped.push(c);
  }
  allComments = deduped;

  // Build the comments block
  const items = allComments.map(c => {
    const safeText = c.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `  <article class="article-comment" style="margin-bottom: 1.5rem; padding: 1rem 1.25rem; border: 1px solid var(--rule); background: rgba(245,232,199,0.15);">
    <p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 0.5rem;">
      <a href="/about/masthead/#${c.byline_id}" style="color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor;">${c.byline_name}</a> · ${c.byline_title}
    </p>
    <p style="margin: 0; font-size: 0.98rem; line-height: 1.55;">${safeText}</p>
  </article>`;
  }).join('\n');

  // Wave 161: singular header when there's only one comment so the room
  // doesn't read empty. "From the Editorial Staff" with one entry felt
  // off; "An editorial response" reads correct for one or many.
  const sectionLabel = allComments.length === 1 ? 'An editorial response' : 'From the Editorial Staff';
  const block = `\n<!-- COMMENTS:START -->\n<section class="article-comments" style="margin: 3rem 0 2rem; padding-top: 2rem; border-top: 1px solid var(--rule);">\n  <p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 1.25rem;">${sectionLabel}</p>\n${items}\n</section>\n<!-- COMMENTS:END -->\n`;

  // Replace existing comments block if present, else insert before subscribe section
  if (html.includes('<!-- COMMENTS:START -->')) {
    html = html.replace(/<!-- COMMENTS:START -->[\s\S]*?<!-- COMMENTS:END -->\n?/, block);
  } else {
    // Insert before the entry-subscribe section
    const subscribeMarker = '<section class="entry-subscribe"';
    const idx = html.indexOf(subscribeMarker);
    if (idx >= 0) {
      html = html.slice(0, idx) + block + html.slice(idx);
    } else {
      // Fallback: insert before </article>
      html = html.replace(/<\/article>\s*<\/main>/, block + '</article>\n</main>');
    }
  }

  await fs.writeFile(htmlPath, html, 'utf8');
}

// Wave 169b: batch support. If ARTICLE_SLUGS is provided, loop through.
async function runAll() {
  if (ARTICLE_SLUGS) {
    const slugs = ARTICLE_SLUGS.split(',').map(s => s.trim()).filter(Boolean);
    console.log(`[comments] batch mode: ${slugs.length} slugs`);
    let ok = 0, fail = 0;
    for (const slug of slugs) {
      console.log(`\n=== [${ok + fail + 1}/${slugs.length}] ${slug} ===`);
      process.env.ARTICLE_SLUG = slug;
      try {
        await main();
        ok++;
      } catch (e) {
        fail++;
        console.error(`[comments] ${slug} FAILED: ${e.message}`);
      }
    }
    console.log(`\n[comments] batch done. ok=${ok} fail=${fail}`);
    if (ok === 0) process.exit(1);
  } else {
    await main();
  }
}
runAll().catch(err => { console.error('[comments] FATAL:', err); process.exit(1); });
