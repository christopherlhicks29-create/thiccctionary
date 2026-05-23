/**
 * Admin: aggregate status for the dashboard tiles.
 * GET only. Returns today's entry, Reel status, submission count, recent workflow runs.
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'thiccctionary-admin',
    ...(opts.headers || {}),
  };
  return fetch(`https://api.github.com${path}`, { ...opts, headers, cache: 'no-store' });
}

export async function onRequestGet({ env }) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }

  const today = new Date().toISOString().slice(0, 10);
  const out = { today };

  try {
    // 1. Today's entry, read entries.json from main
    const cacheBust = Date.now();
    const entriesRes = await gh(`/repos/${REPO}/contents/data/entries.json?ref=main&_=${cacheBust}`, {}, env);
    if (entriesRes.ok) {
      const file = await entriesRes.json();
      const decoded = atob(file.content.replace(/\n/g, ''));
      const entries = JSON.parse(decoded);
      const todayEntry = entries.find(e => e.date === today);
      out.todayEntry = todayEntry ? {
        word: todayEntry.word,
        date: todayEntry.date,
        image: todayEntry.image,
        photographer: todayEntry.photographer,
        category: todayEntry.category,
      } : null;
      out.totalEntries = entries.length;
      out.latestEntry = entries[0] ? { word: entries[0].word, date: entries[0].date } : null;
    }

    // 2. Reel for today, check if videos/<today>.mp4 exists
    const reelRes = await gh(`/repos/${REPO}/contents/videos/${today}.mp4?ref=main&_=${cacheBust}`, {}, env);
    out.todayReelExists = reelRes.ok;

    // 3. Open submission PRs count
    const prRes = await gh(`/repos/${REPO}/pulls?state=open&per_page=50&_=${cacheBust}`, {}, env);
    if (prRes.ok) {
      const prs = await prRes.json();
      out.openSubmissions = prs.filter(pr => (pr.labels || []).some(l => l.name === 'submissions-review')).length;
      out.openDailyEntries = prs.filter(pr => (pr.labels || []).some(l => l.name === 'daily-entry') && !((pr.labels || []).some(l => l.name === 'submissions-review'))).length;
    }

    // 4. Recent workflow runs, latest of each key workflow
    const runsRes = await gh(`/repos/${REPO}/actions/runs?per_page=100&_=${cacheBust}`, {}, env);
    if (runsRes.ok) {
      const runs = (await runsRes.json()).workflow_runs || [];
      const latestOf = name => runs.find(r => r.name === name);
      const summarize = r => r ? {
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
        htmlUrl: r.html_url,
        headSha: (r.head_sha || '').slice(0, 7),
      } : null;
      out.workflows = {
        daily: summarize(latestOf('Daily Thiccc, Generate Draft PR')),
        cronWatchdog: summarize(latestOf('Cron watchdog, alert on missing daily entry or Reel') || latestOf('Cron watchdog, alert on missing daily entry')),
        postOnMerge: summarize(latestOf('Post to Buffer on Daily Merge')),
        siteHealth: summarize(latestOf('Site health audit')),
        postDeployVerify: summarize(latestOf('Post-Deploy Verify')),
      };
    }

    // Wave 202: read audits/buffer-posts/<today>.json so the admin Today's
    // Reel tile can render per-platform status pills (FB / IG / X / etc).
    try {
      const postsRes = await gh('/repos/' + REPO + '/contents/audits/buffer-posts/' + today + '.json?ref=main&_=' + cacheBust, {}, env);
      if (postsRes.ok) {
        const file = await postsRes.json();
        out.todayPosts = JSON.parse(atob(file.content.replace(/\n/g, '')));
      } else {
        out.todayPosts = null;
      }
    } catch (e) {
      out.todayPosts = null;
    }

    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, partial: out }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
  }
}
