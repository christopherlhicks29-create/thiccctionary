#!/usr/bin/env node
/**
 * Brand-mention monitor.
 *
 * Polls free, no-auth APIs (Reddit, HackerNews via Algolia) for any
 * post or comment mentioning "thiccctionary" (or close variants), and
 * writes findings to audits/brand-mentions/<date>.md. New mentions
 * since the last run get highlighted at the top.
 *
 * Sources:
 *   - Reddit:    https://www.reddit.com/search.json?q=<query>&sort=new
 *   - HN:        https://hn.algolia.com/api/v1/search?query=<query>
 *   - Google:    https://news.google.com/rss/search?q=<query>
 *
 * Schedule: daily 13:00 UTC via .github/workflows/brand-mention.yml.
 * Manual fire: data/.fire-brand-mention sentinel.
 *
 * Cost: $0. Both APIs free, no auth, generous rate limits.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audits', 'brand-mentions');
const SEEN_PATH = path.join(AUDIT_DIR, '.seen-ids.json');

const QUERIES = ['thiccctionary', 'thicctionary']; // catch the inevitable misspelling

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'thiccctionary-brand-monitor/1.0 (https://thiccctionary.com)' },
  });
  if (!res.ok) {
    console.warn(`  ! ${url} → HTTP ${res.status}`);
    return null;
  }
  return res.json().catch(() => null);
}

async function reddit(query) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&restrict_sr=on=false`;
  const j = await fetchJson(url);
  if (!j?.data?.children) return [];
  return j.data.children.map(c => ({
    source: 'reddit',
    id: `reddit:${c.data.id}`,
    title: c.data.title,
    subreddit: c.data.subreddit,
    author: c.data.author,
    url: `https://reddit.com${c.data.permalink}`,
    score: c.data.score,
    created: new Date(c.data.created_utc * 1000).toISOString(),
    excerpt: (c.data.selftext || '').slice(0, 200),
  }));
}

async function hackerNews(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)`;
  const j = await fetchJson(url);
  if (!j?.hits) return [];
  return j.hits.map(h => ({
    source: 'hn',
    id: `hn:${h.objectID}`,
    title: h.title || h.story_title || '(comment)',
    author: h.author,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    points: h.points,
    created: h.created_at,
    excerpt: (h.story_text || h.comment_text || '').replace(/<[^>]+>/g, '').slice(0, 200),
  }));
}

async function googleNews(query) {
  // Free, no-auth RSS endpoint. Returns recent news articles mentioning the query.
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'thiccctionary-brand-monitor/1.0' },
  });
  if (!res.ok) { console.warn(`  ! google news ${res.status}`); return []; }
  const xml = await res.text();
  // Parse minimal <item> blocks without a full XML lib
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const grab = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</${tag}>`));
    return m ? m[1].trim() : '';
  };
  return items.slice(0, 25).map(m => {
    const b = m[1];
    const title = grab(b, 'title').replace(/<[^>]+>/g, '');
    const link = grab(b, 'link');
    const pubDate = grab(b, 'pubDate');
    const source = grab(b, 'source').replace(/<[^>]+>/g, '');
    const desc = grab(b, 'description').replace(/<[^>]+>/g, '').slice(0, 200);
    // Hash a stable ID from URL since Google News URLs are stable
    const id = `gnews:${link.split('?')[0].slice(-40)}`;
    return {
      source: 'google-news',
      id,
      title,
      author: source || 'unknown',
      url: link,
      created: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      excerpt: desc,
    };
  });
}

async function loadSeen() {
  try { return new Set(JSON.parse(await fs.readFile(SEEN_PATH, 'utf8'))); }
  catch { return new Set(); }
}

async function saveSeen(seen) {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(SEEN_PATH, JSON.stringify([...seen]));
}

function renderMention(m) {
  const head = `**${m.title}** - ${m.source}${m.subreddit ? '/r/'+m.subreddit : ''} · ${m.author || 'anon'} · ${m.created.slice(0, 10)}`;
  const stats = m.score != null ? ` · ${m.score} points` : (m.points != null ? ` · ${m.points} points` : '');
  const excerpt = m.excerpt ? `\n  > ${m.excerpt.replace(/\n/g, ' ')}` : '';
  return `- ${head}${stats}\n  ${m.url}${excerpt}`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[brand-mention] checking ${QUERIES.join(', ')} for ${today}`);

  const all = [];
  for (const q of QUERIES) {
    const r = await reddit(q);
    const h = await hackerNews(q);
    const g = await googleNews(q);
    console.log(`  ${q}: reddit ${r.length}, hn ${h.length}, gnews ${g.length}`);
    all.push(...r, ...h, ...g);
  }
  // Dedupe by id
  const byId = new Map();
  for (const m of all) byId.set(m.id, m);
  // Algolia HN does fuzzy/prefix matching ('thiccctionary' matches 'TDictionary',
  // 'collation' etc). Enforce a strict substring check on title+excerpt to drop
  // false positives. Reddit is exact-match by default but the filter is harmless.
  const QUERY_RE = /thicc?tionary/i;
  const filtered = [...byId.values()].filter(m => QUERY_RE.test((m.title || '') + ' ' + (m.excerpt || '')));
  const mentions = filtered.sort((a, b) => b.created.localeCompare(a.created));

  const seen = await loadSeen();
  const newOnes = mentions.filter(m => !seen.has(m.id));
  for (const m of mentions) seen.add(m.id);
  await saveSeen(seen);

  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const logPath = path.join(AUDIT_DIR, `${today}.md`);

  const sections = [];
  sections.push(`# Brand mention report ${today}`);
  sections.push(`Queries: ${QUERIES.join(', ')}`);
  sections.push(`Sources: Reddit, HackerNews (Algolia), Google News RSS`);
  sections.push(``);
  sections.push(`**Total mentions found: ${mentions.length}**`);
  sections.push(`**New since last check: ${newOnes.length}**`);
  sections.push(``);
  if (newOnes.length > 0) {
    sections.push(`## New mentions (highlighted)`);
    sections.push(``);
    for (const m of newOnes) sections.push(renderMention(m));
    sections.push(``);
  }
  if (mentions.length > 0) {
    sections.push(`## All mentions (newest first)`);
    sections.push(``);
    for (const m of mentions) sections.push(renderMention(m));
  } else {
    sections.push(`No mentions found on either source. The internet has yet to notice. Catalogue continues.`);
  }
  await fs.writeFile(logPath, sections.join('\n'));
  console.log(`[brand-mention] wrote ${logPath} (${mentions.length} total, ${newOnes.length} new)`);
}

main().catch(e => { console.error('[brand-mention] FATAL:', e); process.exit(1); });
