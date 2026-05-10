/**
 * Admin: list entries OR get one entry by date.
 *
 * GET /api/admin/entries           → list all (metadata only — no etymology for speed)
 * GET /api/admin/entries?date=YYYY-MM-DD → full entry data
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'thiccctionary-admin',
      ...(opts.headers || {}),
    },
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = await gh(`/repos/${REPO}/contents/data/entries.json?ref=main`, {}, env);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const file = await res.json();
    const sha = file.sha;
    const entries = JSON.parse(atob(file.content.replace(/\n/g, '')));

    const url = new URL(request.url);
    const date = url.searchParams.get('date');

    if (date) {
      const entry = entries.find(e => e.date === date);
      if (!entry) return new Response(JSON.stringify({ error: 'Entry not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ entry, sha, indexInFile: entries.findIndex(e => e.date === date) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // List metadata only
    const list = entries.map(e => ({
      date: e.date,
      word: e.word,
      image: e.image,
      photographer: e.photographer,
      category: e.category || null,
      bookReady: e.bookReady ?? null,
      tags: e.tags || [],
    }));
    return new Response(JSON.stringify({ entries: list, total: entries.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
