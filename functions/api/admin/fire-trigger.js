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
  'daily':         { path: 'data/.fire-daily',          needsDate: false, contentMode: 'text', label: 'Daily cron (generate today\'s entry)' },
  'tiktok-latest': { path: 'data/.fire-tiktok-latest',  needsDate: false, contentMode: 'text', label: 'Build Reel video for latest entry' },
  'tiktok-date':   { path: 'data/.fire-tiktok',         needsDate: true,  contentMode: 'text', label: 'Build Reel video for specific date' },
  'reel-latest':   { path: 'data/.fire-reel-latest',    needsDate: false, contentMode: 'text', label: 'Cross-post Reel for latest entry' },
  'reel-date':     { path: 'data/.fire-reel',           needsDate: true,  contentMode: 'text', label: 'Cross-post Reel for specific date' },
  'backfill':      { path: 'data/.fire-backfill',       needsDate: true,  contentMode: 'text', label: 'Backfill morning post + newsletter for date' },
  'regen-image':   { path: 'data/.fire-image-regen.json', needsDate: true, contentMode: 'image-regen-json', label: 'Regenerate image for date' },
  'regen-text':    { path: 'data/.fire-text-regen.json',  needsDate: true, contentMode: 'text-regen-json',  label: 'Regenerate entry text for date' },
  'office-post':   { path: 'data/.fire-office',           needsDate: false, contentMode: 'office-json',     label: 'Fire an employee social post (FB + X)' },
  'buffer-list':   { path: 'data/.fire-buffer-queue.json', needsDate: false, contentMode: 'buffer-list-json',   label: 'List Buffer scheduled posts' },
  'buffer-purge':  { path: 'data/.fire-buffer-queue.json', needsDate: false, contentMode: 'buffer-purge-json',  label: 'Delete Buffer posts matching phrase(s)' },
  // Wave 152: direct workflow_dispatch triggers. Used by the admin auto-fix
  // loop to re-run failed pipelines without writing a sentinel file. Keyed
  // by workflow filename (under .github/workflows/).
  'site-health':         { mode: 'workflow-dispatch', workflow: 'site-health.yml',         label: 'Run site health audit' },
  'cron-watchdog':       { mode: 'workflow-dispatch', workflow: 'cron-watchdog.yml',       label: 'Run cron watchdog check' },
  'post-deploy-verify':  { mode: 'workflow-dispatch', workflow: 'post-deploy-verify.yml',  label: 'Re-verify the live site' },
  'post-on-merge':       { mode: 'workflow-dispatch', workflow: 'post-on-merge.yml',       label: 'Re-run post-to-Buffer on latest daily' },
  'daily-dispatch':      { mode: 'workflow-dispatch', workflow: 'daily.yml',               label: 'Re-run daily entry generator' },
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

  // Wave 152: workflow_dispatch path - re-run a workflow directly via
  // GitHub Actions API instead of writing a sentinel file. Used by the
  // admin auto-fix loop to re-trigger pipelines that don't have a
  // sentinel-driven entry point (post-deploy-verify, site-health, etc.)
  if (cfg.mode === 'workflow-dispatch') {
    try {
      const ts = new Date().toISOString();
      const who = sourceEmail || 'admin-panel-autofix';
      const dispatchRes = await gh(`/repos/${REPO}/actions/workflows/${cfg.workflow}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { reason: `admin auto-fix at ${ts} by ${who}` },
        }),
      }, env);
      if (!dispatchRes.ok) {
        // Try again without inputs (some workflows have no `inputs:` block at all
        // and the API rejects unknown input keys with 422)
        const dispatchRes2 = await gh(`/repos/${REPO}/actions/workflows/${cfg.workflow}/dispatches`, {
          method: 'POST',
          body: JSON.stringify({ ref: 'main' }),
        }, env);
        if (!dispatchRes2.ok) {
          const err = await dispatchRes2.text();
          return new Response(JSON.stringify({ error: `Workflow dispatch failed: ${dispatchRes2.status} ${err.slice(0, 300)}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify({
        ok: true,
        trigger,
        label: cfg.label,
        workflow: cfg.workflow,
        message: `Workflow dispatched. Will appear in Actions tab within ~10s.`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (cfg.needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return new Response(JSON.stringify({ error: `Trigger '${trigger}' requires date in YYYY-MM-DD format` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Build sentinel content based on mode
  const ts = new Date().toISOString();
  const who = sourceEmail || 'admin-panel';
  let content;
  if (cfg.contentMode === 'image-regen-json') {
    const payload = { dates: date, subject_override: (body.subjectOverride || '').trim(), _fired: { at: ts, by: who } };
    content = JSON.stringify(payload, null, 2);
  } else if (cfg.contentMode === 'text-regen-json') {
    const payload = { dates: date, word_override: (body.wordOverride || '').trim(), _fired: { at: ts, by: who } };
    content = JSON.stringify(payload, null, 2);
  } else if (cfg.contentMode === 'office-json') {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      date: today,
      byline_override: (body.bylineOverride || '').trim(),
      topic_kind: (body.topicKind || 'either').trim(),
      _fired: { at: ts, by: who },
    };
    content = JSON.stringify(payload, null, 2);
  } else if (cfg.contentMode === 'buffer-list-json') {
    const payload = { action: 'list', _t: Date.now(), _fired: { at: ts, by: who } };
    content = JSON.stringify(payload, null, 2);
  } else if (cfg.contentMode === 'buffer-purge-json') {
    const terms = (body.matchTerms || '').split('\n').map(t => t.trim()).filter(Boolean);
    const payload = { action: 'delete-by-match', match_terms: terms, dry_run: !!body.dryRun, _t: Date.now(), _fired: { at: ts, by: who } };
    content = JSON.stringify(payload, null, 2);
  } else {
    content = cfg.needsDate
      ? `${date}  # Fired via admin panel at ${ts} by ${who}\n`
      : `${ts} Fired via admin panel by ${who}\n`;
  }
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
