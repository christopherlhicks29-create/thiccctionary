/**
 * Admin: list open submission PRs.
 * GET only. Returns PRs with submissions-review label, enriched with the proposed entry.
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'thiccctionary-admin',
    'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    ...(opts.headers || {}),
  };
  return fetch(`https://api.github.com${path}`, { ...opts, headers, cache: 'no-store' });
}

export async function onRequestGet({ env }) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }
  try {
    const res = await gh(`/repos/${REPO}/pulls?state=open&per_page=50`, {}, env);
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const prs = await res.json();
    const subs = prs.filter(pr => (pr.labels || []).some(l => l.name === 'submissions-review'));

    const enriched = await Promise.all(subs.map(async pr => {
      let entry = null;
      try {
        const fileRes = await gh(`/repos/${REPO}/contents/data/entries.json?ref=${pr.head.ref}`, {}, env);
        if (fileRes.ok) {
          const file = await fileRes.json();
          const decoded = atob(file.content.replace(/\n/g, ''));
          const entries = JSON.parse(decoded);
          entry = entries[0] || null;
        }
      } catch (e) { /* enrichment is best-effort */ }
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        branch: pr.head.ref,
        createdAt: pr.created_at,
        htmlUrl: pr.html_url,
        user: pr.user?.login,
        entry,
      };
    }));

    return new Response(JSON.stringify({ submissions: enriched }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }
}
