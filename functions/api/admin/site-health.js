/**
 * Admin: latest site-health audit summary.
 * Reads the most recent audits/health-*.md file from main and returns summary.
 */

const REPO = 'christopherlhicks29-create/thiccctionary';

async function gh(path, opts = {}, env) {
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'thiccctionary-admin',
    ...(opts.headers || {}),
  };
  return fetch(`https://api.github.com${path}`, { ...opts, headers });
}

export async function onRequestGet({ env }) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const listRes = await gh(`/repos/${REPO}/contents/audits?ref=main`, {}, env);
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: `Couldn't list audits dir: ${listRes.status}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const files = (await listRes.json()).filter(f => /^health-\d{4}-\d{2}-\d{2}\.md$/.test(f.name));
    files.sort((a, b) => b.name.localeCompare(a.name));
    const latest = files[0];
    if (!latest) {
      return new Response(JSON.stringify({ error: 'No health audits found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const fileRes = await gh(`/repos/${REPO}/contents/audits/${latest.name}?ref=main`, {}, env);
    if (!fileRes.ok) {
      return new Response(JSON.stringify({ error: `Couldn't read audit file: ${fileRes.status}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const file = await fileRes.json();
    const mdBytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  const md = new TextDecoder().decode(mdBytes);

    // Parse summary
    const statusMatch = md.match(/\*\*Status:\*\*\s*(.+)/);
    const scannedMatch = md.match(/\*\*Scanned:\*\*\s*(.+)/);
    const sections = [];
    const sectionRe = /^##\s+(.+?)\s*\((\d+)\)/gm;
    let m;
    while ((m = sectionRe.exec(md)) !== null) {
      sections.push({ name: m[1].trim(), count: parseInt(m[2], 10) });
    }

    return new Response(JSON.stringify({
      filename: latest.name,
      status: statusMatch ? statusMatch[1].trim() : 'unknown',
      scanned: scannedMatch ? scannedMatch[1].trim() : null,
      sections,
      htmlUrl: latest.html_url,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
