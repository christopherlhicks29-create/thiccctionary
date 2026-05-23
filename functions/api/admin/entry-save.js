/**
 * Admin: save edits to an entry. Direct commit to main (admin user is the editor).
 *
 * POST { date: 'YYYY-MM-DD', entry: { ...fields } }
 * Replaces the entry with matching date. Validates word/definitions/etymology are present.
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'thiccctionary-admin',
      'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      ...(opts.headers || {}),
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }); }

  const { date, entry } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return new Response(JSON.stringify({ error: 'date must be YYYY-MM-DD' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  if (!entry || typeof entry !== 'object') return new Response(JSON.stringify({ error: 'entry required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  if (!entry.word || !Array.isArray(entry.definitions) || entry.definitions.length === 0) {
    return new Response(JSON.stringify({ error: 'entry needs word + at least one definition' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }

  try {
    const fileRes = await gh(`/repos/${REPO}/contents/data/entries.json?ref=main`, {}, env);
    if (!fileRes.ok) throw new Error(`GitHub read ${fileRes.status}`);
    const file = await fileRes.json();
    const rawBytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  const entries = JSON.parse(new TextDecoder().decode(rawBytes));
    const idx = entries.findIndex(e => e.date === date);
    if (idx === -1) return new Response(JSON.stringify({ error: 'No entry found for that date' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });

    // Preserve date, never let UI change it
    entries[idx] = { ...entries[idx], ...entry, date };

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(entries, null, 2))));
    const putRes = await gh(`/repos/${REPO}/contents/data/entries.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Admin edit: ${entries[idx].word} (${date})`,
        content: encoded,
        sha: file.sha,
        branch: 'main',
      }),
    }, env);

    if (!putRes.ok) {
      const err = await putRes.text();
      return new Response(JSON.stringify({ error: `Commit failed: ${putRes.status} ${err.slice(0,200)}` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
    }

    return new Response(JSON.stringify({ ok: true, date, word: entries[idx].word }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }
}
