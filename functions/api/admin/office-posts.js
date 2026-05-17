/**
 * GET /api/admin/office-posts
 *
 * Returns the most recent office posts from the queue, decorated with status,
 * byline display name, and Buffer-dashboard hint links.
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(p, env) {
  const r = await fetch(`https://api.github.com${p}`, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_PAT}`,
      'Accept': 'application/vnd.github.raw',
      'User-Agent': 'thiccctionary-admin',
    },
  });
  if (!r.ok) return null;
  return await r.text();
}

export async function onRequestGet({ env }) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const queueRaw = await gh(`/repos/${REPO}/contents/data/office-post-queue.json?ref=main`, env);
    if (!queueRaw) {
      return new Response(JSON.stringify({ posts: [], note: 'queue not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const queue = JSON.parse(queueRaw);
    const recent = queue.slice(0, 25).map(p => ({
      id: p.id,
      created: p.created,
      byline_id: p.byline_id,
      byline_display: p.byline_display,
      topic_kind: p.topic_kind,
      score: p.score,
      status: p.status,
      success_count: p.success_count,
      failure_count: p.failure_count,
      text: p.text,
      errors: p.errors || [],
    }));
    return new Response(JSON.stringify({ posts: recent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
