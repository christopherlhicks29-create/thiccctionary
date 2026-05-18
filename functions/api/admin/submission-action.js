/**
 * Admin: approve or reject a submission PR.
 * POST { prNumber: number, action: 'approve' | 'reject' }
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'thiccctionary-admin',
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  return fetch(`https://api.github.com${path}`, { ...opts, headers });
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { prNumber, action } = body;
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return new Response(JSON.stringify({ error: 'prNumber must be a positive integer' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (action !== 'approve' && action !== 'reject') {
    return new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    if (action === 'approve') {
      const res = await gh(`/repos/${REPO}/pulls/${prNumber}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: 'squash' }),
      }, env);
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: `Merge failed: ${res.status} ${err.slice(0,200)}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true, action: 'approved' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // reject
    const prRes = await gh(`/repos/${REPO}/pulls/${prNumber}`, {}, env);
    if (!prRes.ok) {
      return new Response(JSON.stringify({ error: `PR not found: ${prRes.status}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const pr = await prRes.json();
    const branch = pr.head.ref;
    const closeRes = await gh(`/repos/${REPO}/pulls/${prNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    }, env);
    if (!closeRes.ok) {
      return new Response(JSON.stringify({ error: `Close failed: ${closeRes.status}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    // Delete branch (best-effort, don't fail if already gone)
    await gh(`/repos/${REPO}/git/refs/heads/${branch}`, { method: 'DELETE' }, env).catch(() => {});
    return new Response(JSON.stringify({ ok: true, action: 'rejected' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
