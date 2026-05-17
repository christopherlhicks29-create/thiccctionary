/**
 * Office post generator.
 *
 * One-shot: pick a staff byline, pick or auto-generate a topic (running-bit
 * callback OR a thiccc-thing observation), have Claude write a ≤280-char
 * social post in character, rate with gpt-4o, publish if ≥7/10.
 *
 * Output: appends to data/office-post-queue.json so post-to-buffer.js can
 * pick it up via POST_MODE=office. Failed drafts skip silently.
 *
 * Required env:
 *   ANTHROPIC_API_KEY  for the generator
 *   OPENAI_API_KEY     for the rater
 *
 * Optional env:
 *   BYLINE_OVERRIDE    eli|teddy|bart|margie|spider, force a byline
 *   TOPIC_KIND         "office" or "thiccc" or "either" (default: either)
 *   DRY_RUN            "1" to skip writing to disk
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAFF_PATH = path.join(ROOT, 'data', 'editorial-staff.json');
const EVENTS_PATH = path.join(ROOT, 'data', 'office-events.json');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const QUEUE_PATH = path.join(ROOT, 'data', 'office-post-queue.json');
const AUDIT_DIR = path.join(ROOT, 'audits');
const AUDIT_LOG = path.join(AUDIT_DIR, 'social-quality.jsonl');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!OPENAI_API_KEY) { console.error('FATAL: OPENAI_API_KEY missing'); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY missing'); process.exit(1); }

const QUALITY_THRESHOLD = 7;
const MAX_ATTEMPTS = 3;
const MAX_LEN = 280;

function weightedPick(items, weightKey = 'weight') {
  const total = items.reduce((a, x) => a + (x[weightKey] || 0), 0);
  let r = Math.random() * total;
  for (const x of items) { r -= (x[weightKey] || 0); if (r <= 0) return x; }
  return items[items.length - 1];
}

function pickByline(staff) {
  // Social weight distribution: same as social-byline picker in post-to-buffer.js
  // Eli 35, Teddy 25, Bart 20, Margie 12, Spider 8 (no "unsigned" here — these
  // are explicitly character posts).
  const dist = { eli: 35, teddy: 25, bart: 20, margie: 12, spider: 8 };
  const ov = (process.env.BYLINE_OVERRIDE || '').trim().toLowerCase();
  if (ov && staff.staff.find(x => x.id === ov)) return staff.staff.find(x => x.id === ov);
  const weighted = staff.staff.map(s => ({ ...s, weight: dist[s.id] || 1 }));
  return weightedPick(weighted);
}

function pickTopic(byline, events, entries, recentPosts) {
  const kind = (process.env.TOPIC_KIND || 'either').toLowerCase();
  if (kind === 'reply' || (kind === 'either' && Math.random() < 0.3)) {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    const eligible = (recentPosts || []).filter(p => p.byline_id && p.byline_id !== byline.id && p.created >= cutoff && p.text);
    if (eligible.length > 0) {
      const target = eligible[Math.floor(Math.random() * eligible.length)];
      console.log('[office] reply target: ' + target.byline_id + ' from ' + target.created.slice(0,10));
      return { kind: 'reply', target };
    }
  }
  const eligibleBits = events.running_bits.filter(b => !b.characters || b.characters.includes(byline.id));
  const useOffice = kind === 'office' || (kind === 'either' && Math.random() < 0.6);
  if (useOffice && eligibleBits.length > 0) {
    const bit = eligibleBits[Math.floor(Math.random() * eligibleBits.length)];
    return { kind: 'office', bit };
  }
  const recent = entries.slice(0, 14);
  const entry = recent[Math.floor(Math.random() * recent.length)];
  return { kind: 'thiccc', entry };
}

async function callClaude(system, userMessage, model = 'claude-sonnet-4-6') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 600, system, messages: [{ role: 'user', content: userMessage }], temperature: 0.85 }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function callOpenAI(messages, model = 'gpt-4o') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

function buildSystemPrompt(byline, corpus) {
  const ownCorpus = (corpus && corpus.own && corpus.own.length)
    ? '\n\nYOUR RECENT SOCIAL POSTS (you wrote these, maintain continuity, evolve from them):\n' + corpus.own.map(p => '- "' + p.text.slice(0, 200) + '" (' + (p.created || '').slice(0,10) + ')').join('\n')
    : '';
  const colleagueCorpus = (corpus && corpus.colleagues && corpus.colleagues.length)
    ? '\n\nRECENT POSTS BY COLLEAGUES (you may reference, mock, or footnote these):\n' + corpus.colleagues.map(p => '- ' + p.byline_id + ': "' + p.text.slice(0, 200) + '"').join('\n')
    : '';
  const baseTpl = `You are ${byline.name}, ${byline.title} at Thiccctionary (a satirical online dictionary of objects of unusual girth).

You are writing a short social media post (≤${MAX_LEN} characters total, including the signature). Voice anchors:

${byline.voice}

YOUR OBSESSIONS (lean into one):
${(byline.obsessions || []).map(o => '- ' + o).join('\n')}

YOUR WORKPLACE DYNAMICS (use sparingly, only when the topic invites it):
${(byline.drama_hooks || []).map(h => '- ' + h).join('\n')}

WRITING TICS:
${(byline.tics || []).map(t => '- ' + t).join('\n')}

HARD RULES:
1. ≤${MAX_LEN} characters TOTAL (including signature line). Count carefully.
2. End with a newline, then "${byline.display || byline.name.split(' ')[0]}" (your social signature).
3. Voice is dry editorial-satire, not modern internet voice. Think 1962 magazine editor, not 2024 brand account.
4. NO em-dashes anywhere. Use commas, periods, colons, parens.
5. NO words: embodies, encapsulates, intersection, transcends, tapestry, symphony, harmony, dance, captures the essence.
6. NO "not just X, but Y" phrasing.
7. The post should be FUNNY. Dry-funny. Observational. The kind of thing that makes someone screenshot and share.
8. Output the post text only. No commentary, no quote marks, no preamble. Just the post.` + ownCorpus + colleagueCorpus;
  return baseTpl;
}

function buildUserPrompt(topic, byline, allStaff) {
  if (topic.kind === 'reply') {
    const targetStaff = allStaff.staff.find(function(x){return x.id === topic.target.byline_id;});
    const targetName = targetStaff ? targetStaff.name : topic.target.byline_id;
    const targetTitle = targetStaff ? targetStaff.title : 'colleague';
    return 'Write a social post REACTING to a colleague\'s recent post.\n\n' +
      'YOUR COLLEAGUE: ' + targetName + ' (' + targetTitle + ')\n' +
      'THEIR POST (from ' + topic.target.created.slice(0,10) + '):\n' +
      '~~~\n' + topic.target.text + '\n~~~\n\n' +
      'Your reply should:\n' +
      '- Stay in YOUR character (not theirs)\n' +
      '- Reference their post specifically: quote a phrase, take a position, push back, agree mockingly, footnote them, whatever fits your dynamic\n' +
      '- Acknowledge it is a response (e.g. "Re: the Junior Cataloguer\'s recent post...", "Eli\'s comment is, as usual, missing the point.")\n' +
      '- Less than or equal to ' + MAX_LEN + ' chars TOTAL with signature\n' +
      '- Be funny. The whole point is the dynamic between you.\n\n' +
      'End with your signature.';
  }
  if (topic.kind === 'office') {
    return `Write a social post about this office event/running bit:

"${topic.bit.summary}"

Keep it in character. Make it specific and funny. Land the joke. End with your signature.`;
  } else {
    const entry = topic.entry;
    const def = (entry.definitions?.[0] || entry.definition || '').replace(/<[^>]+>/g, '').slice(0, 200);
    return `Write a social post about this catalogued subject:

Subject: ${entry.word}
Definition: ${def}
${entry.example ? 'Example: ' + entry.example.replace(/<[^>]+>/g, '').slice(0, 150) : ''}

React to it in character. Notice something specific about it. Land a dry joke. End with your signature.`;
  }
}

async function rateDraft(draft, byline, topic) {
  const sys = `You are a senior comedy editor at a satirical publication. You rate draft social media posts on a 0-10 scale for HUMOR + VOICE + SHAREABILITY combined.

A 10 is a screenshot-worthy line that a stranger would share. An 8 is solid, a clear win, the kind of post that builds the brand. A 7 is good enough to publish. A 6 is mediocre and we should reject. A 5 or below is bad.

Be tough. Reject easily. Specific anchors:
- Dry-funny observational voice that lands a joke = 8+
- Generic / could-be-any-brand-account voice = 5 or below
- Voice matches the byline's character traits = bonus
- Banned phrases (em-dashes, "embodies", "transcends", etc) = automatic 4
- "Not just X, but Y" used more than once = automatic 5
- Wordy / not punchy = penalty
- Lazy or obvious joke = penalty
- Specific funny detail = bonus

Return JSON: {"score": 0-10, "verdict": "publish" or "reject", "reasons": ["specific reason 1", "specific reason 2"]}

Verdict is "publish" only if score >= ${QUALITY_THRESHOLD}.`;

  const user = `BYLINE: ${byline.name} (${byline.title})
TOPIC: ${topic.kind === 'office' ? 'office event: ' + topic.bit.summary : 'thiccc subject: ' + (topic.entry?.word || '')}

DRAFT POST:
"""
${draft}
"""

Rate it.`;

  return await callOpenAI([{ role: 'system', content: sys }, { role: 'user', content: user }]);
}

async function appendAuditLog(record) {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.appendFile(AUDIT_LOG, JSON.stringify(record) + '\n', 'utf8');
}

async function appendQueue(post) {
  let queue = [];
  try { queue = JSON.parse(await fs.readFile(QUEUE_PATH, 'utf8')); } catch (e) { queue = []; }
  queue.unshift(post);
  // Keep only last 100
  queue = queue.slice(0, 100);
  await fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

async function extendEvents(events, post, byline, topic) {
  // If the post landed a fresh callback or new bit, add a brief auto_extension entry.
  const newEntry = {
    id: `auto-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    byline_id: byline.id,
    summary: byline.name.split(' ')[0] + ' posted about ' + (topic.kind === 'office' ? topic.bit.id : topic.kind === 'reply' ? ('reply to ' + topic.target.byline_id) : topic.entry?.word) + ': "' + post.slice(0, 100) + '..."',
  };
  events.auto_extensions = events.auto_extensions || [];
  events.auto_extensions.unshift(newEntry);
  events.auto_extensions = events.auto_extensions.slice(0, 30); // cap
  await fs.writeFile(EVENTS_PATH, JSON.stringify(events, null, 2) + '\n', 'utf8');
}

async function main() {
  const staff = JSON.parse(await fs.readFile(STAFF_PATH, 'utf8'));
  const events = JSON.parse(await fs.readFile(EVENTS_PATH, 'utf8'));
  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));

  let recentPosts = [];
  try {
    const raw = await fs.readFile(QUEUE_PATH, 'utf8');
    recentPosts = JSON.parse(raw).slice(0, 30);
  } catch (e) { /* queue not present yet */ }
  const byline = pickByline(staff);
  const topic = pickTopic(byline, events, entries, recentPosts);
  console.log(`[office] byline=${byline.id} topic=${topic.kind}`);

  let bestDraft = null;
  let bestScore = -1;
  let lastRating = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[office] attempt ${attempt}/${MAX_ATTEMPTS}…`);
    const corpus = {
      own: recentPosts.filter(p => p.byline_id === byline.id).slice(0, 5),
      colleagues: recentPosts.filter(p => p.byline_id && p.byline_id !== byline.id).slice(0, 4),
    };
    const sys = buildSystemPrompt(byline, corpus);
    const user = buildUserPrompt(topic, byline, staff);
    let draft = await callClaude(sys, user);
    // Trim quoted wrapping if Claude added it
    draft = draft.replace(/^["'`]+|["'`]+$/g, '').trim();

    // Length check
    if (draft.length > MAX_LEN) {
      console.log(`[office]   length ${draft.length} > ${MAX_LEN}, asking for shorter`);
      // Quick retry with explicit length constraint
      draft = await callClaude(sys, `${user}\n\nYour last draft was ${draft.length} chars, must be ≤${MAX_LEN}. Cut it. Make every word count.`);
      draft = draft.replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    const rating = await rateDraft(draft, byline, topic);
    console.log(`[office]   score=${rating.score}/10 verdict=${rating.verdict}`);
    if (rating.reasons) rating.reasons.forEach(r => console.log(`     • ${r}`));
    lastRating = rating;
    if (rating.score > bestScore) {
      bestScore = rating.score;
      bestDraft = draft;
    }
    if (rating.verdict === 'publish' && rating.score >= QUALITY_THRESHOLD) break;
  }

  const passed = bestScore >= QUALITY_THRESHOLD;
  const record = {
    ts: new Date().toISOString(),
    byline: byline.id,
    topic_kind: topic.kind,
    topic_id: topic.kind === 'office' ? topic.bit.id : topic.kind === 'reply' ? ('reply-to-' + topic.target.byline_id) : topic.entry?.date,
    best_score: bestScore,
    passed,
    draft: bestDraft,
    last_reasons: lastRating?.reasons || [],
  };
  await appendAuditLog(record);

  if (!passed) {
    console.log(`[office] FAILED quality bar (best ${bestScore}/${QUALITY_THRESHOLD}). Skipping. No post created.`);
    process.exit(0);
  }

  const post = {
    id: `office-${Date.now()}`,
    created: new Date().toISOString(),
    byline_id: byline.id,
    byline_display: byline.name.split(' ')[0],
    topic_kind: topic.kind,
    text: bestDraft,
    score: bestScore,
    status: 'queued',
  };
  console.log(`\n[office] PASSED ${bestScore}/10. Queued:\n---\n${bestDraft}\n---`);

  if (process.env.DRY_RUN === '1') {
    console.log('[office] DRY_RUN=1, not writing to disk');
    return;
  }
  await appendQueue(post);
  await extendEvents(events, bestDraft, byline, topic);
  console.log('[office] queued to data/office-post-queue.json, story bible extended');
}

main().catch(err => {
  console.error('[office] FATAL:', err);
  process.exit(1);
});
