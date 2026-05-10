/**
 * Admin: fire a sentinel-trigger workflow by committing a sentinel file.
 *
 * POST { trigger: string, date?: string }
 *
 * Triggers map to sentinel files:
 *   'daily'          → data/.fire-daily
 *   'tiktok-latest'  → data/.fire-tiktok-latest
 *   'tiktok-date'    → data/.fire-tiktok            (date in body required)
 *   'reel-latest'    → data/.fire-reel-latest
 *   'reel-date'      → data/.fire-reel              (date in body required)
 *   'backfill'       → data/.fire-backfill          (date in body required)
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

const TRIGGERS = {
  'daily':         { path: 'data/.fire-daily',          needsDate: false, label: 'Daily cron (generate today\'s entry)' },
  'tiktok-latest': { path: 'data/.fire-tiktok-latest',  needsDate: false, label: 'Build Reel video for latest entry' },
  'tiktok-date':   { path: 'data/.fire-tiktok',         needsDate: true,  label: 'Build Reel video for specific date' },
  'reel-latest':   { path: 'data/.fire-reel-latest',    needsDate: false, label: 'Cross-post Reel for latest entry' },
  'reel-date':     { path: 'data/.fire-reel',           needsDate: true,  label: 'Cross-post Reel for specific date' },
  'backfill':      { path: 'data/.fire-backfill',       needsDate: true,  label: 'Backfill morning post + newsletter for date' },
};

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

  const { trigger, date, sourceEmail } = body;
  const cfg = TRIGGERS[trigger];
  if (!cfg) {
    return new Response(JSON.stringify({ error: `Unknown trigger: ${trigger}. Valid: ${Object.keys(TRIGGERS).join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (cfg.needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return new Response(JSON.stringify({ error: `Trigger '${trigger}' requires date in YYYY-MM-DD format` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Build sentinel content
  const ts = new Date().toISOString();
  const who = sourceEmail || 'admin-panel';
  const content = cfg.needsDate
    ? `${date}  # Fired via admin panel at ${ts} by ${who}\n`
    : `${ts} Fired via admin panel by ${who}\n`;
  const encoded = btoa(unescape(encodeURIComponent(content)));

  try {
    // Check if the file already exists (need its SHA for update)
    let sha = null;
    const getRes = await gh(`/repos/${REPO}/contents/${cfg.path}?ref=main`, {}, env);
    if (getRes.ok) {
      const f = await getRes.json();
      sha = f.sha;
    }

    const putRes = await gh(`/repos/${REPO}/contents/${cfg.path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Fire trigger '${trigger}'${cfg.needsDate ? ` for ${date}` : ''} (via admin panel)`,
        content: encoded,
        sha: sha || undefined,
        branch: 'main',
      }),
    }, env);

    if (!putRes.ok) {
      const err = await putRes.text();
      return new Response(JSON.stringify({ error: `Failed to commit sentinel: ${putRes.status} ${err.slice(0, 300)}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      ok: true,
      trigger,
      label: cfg.label,
      sentinelPath: cfg.path,
      message: `Fired. Workflow should start within ~30s. Check https://github.com/${REPO}/actions for status.`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
