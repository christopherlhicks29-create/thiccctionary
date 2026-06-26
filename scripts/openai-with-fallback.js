/**
 * openai-with-fallback.js - drop-in replacement for
 *   fetch('https://api.openai.com/v1/chat/completions', init)
 *
 * Call openaiChat(init) exactly like that fetch. It tries OpenAI first and
 * returns the real Response when OpenAI is healthy (zero behavior change). If
 * OpenAI is DOWN (429 / insufficient_quota / auth / 5xx) and ANTHROPIC_API_KEY
 * is set, it transparently re-issues the request against Anthropic (Claude) and
 * returns a Response-shaped object so callers that do
 *   const data = await res.json(); data.choices[0].message.content
 * keep working unchanged. Vision messages (OpenAI image_url parts) are
 * converted to Anthropic base64 image blocks. This is what lets the daily
 * pipeline self-heal through an OpenAI quota outage.
 *
 * Env: OPENAI_API_KEY (primary), ANTHROPIC_API_KEY (fallback),
 *      ANTHROPIC_FALLBACK_MODEL (optional, default claude-sonnet-4-6).
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-sonnet-4-6';

export function extractJson(s) {
  s = String(s == null ? '' : s).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return (a >= 0 && b > a) ? s.slice(a, b + 1) : s;
}

function looksDown(status, text) {
  if (status === 429 || status === 401 || status === 403) return true;
  if (status >= 500) return true;
  if (/insufficient_quota|exceeded your current quota|billing|rate limit|overloaded/i.test(text || '')) return true;
  return false;
}

// Convert OpenAI-style messages (including vision content arrays) to Anthropic.
async function toAnthropic(messages) {
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const t = typeof m.content === 'string' ? m.content : '';
      system += (system ? '\n\n' : '') + t;
      continue;
    }
    let content;
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = [];
      for (const part of m.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          const url = part.image_url?.url;
          if (!url) continue;
          const r = await fetch(url);
          const buf = Buffer.from(await r.arrayBuffer());
          const mt = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
          content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: buf.toString('base64') } });
        }
      }
    } else {
      content = String(m.content);
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system, messages: out };
}

function fauxResponse(content) {
  return {
    ok: true,
    status: 200,
    text: async () => content,
    json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  };
}

export async function openaiChat(init) {
  const body = JSON.parse(init.body);
  const wantJson = body.response_format?.type === 'json_object';
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  // 1) Try OpenAI first - unchanged happy path.
  let downReason = null;
  try {
    const res = await fetch(OPENAI_URL, init);
    if (res.ok) return res;
    const text = await res.text();
    if (!hasAnthropic || !looksDown(res.status, text)) {
      // Normal error - preserve OpenAI behavior (caller throws on !ok).
      return { ok: false, status: res.status, text: async () => text, json: async () => { try { return JSON.parse(text); } catch { return { error: text }; } } };
    }
    downReason = `status ${res.status}`;
  } catch (e) {
    if (!hasAnthropic) throw e;
    downReason = `fetch error ${e.message}`;
  }

  // 2) OpenAI is down and we have Anthropic - fall back.
  console.warn(`[llm-fallback] OpenAI unavailable (${downReason}); falling back to Anthropic ${FALLBACK_MODEL}.`);
  const { system, messages } = await toAnthropic(body.messages);
  const sys = system + (wantJson ? '\n\nIMPORTANT: Respond with ONLY a single valid JSON object. No prose, no markdown, no code fences.' : '');
  let temp = typeof body.temperature === 'number' ? body.temperature : 0.8;
  if (temp > 1) temp = 1;
  if (temp < 0) temp = 0;

  const ares = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: FALLBACK_MODEL, max_tokens: 2000, temperature: temp, system: sys, messages }),
  });
  if (!ares.ok) {
    const t = await ares.text();
    return { ok: false, status: ares.status, text: async () => t, json: async () => { throw new Error(`Anthropic fallback failed: ${ares.status} ${t}`); } };
  }
  const adata = await ares.json();
  let content = (adata.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (wantJson) content = extractJson(content);
  return fauxResponse(content);
}
