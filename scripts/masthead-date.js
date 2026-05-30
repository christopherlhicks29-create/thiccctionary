/**
 * Wave 217: shared masthead date + issue updater.
 * Any page with `<span id="issue-number">` and `<span id="today-date">`
 * gets the same treatment as the homepage masthead.
 * Reads entries count from /data/entries.json (cached).
 */
(async function () {
  const dateEl = document.getElementById('today-date');
  const issueEl = document.getElementById('issue-number');
  if (dateEl) {
    const today = new Date();
    dateEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (issueEl) {
    try {
      const res = await fetch('/data/entries.json', { cache: 'no-store' });
      if (res.ok) {
        const entries = await res.json();
        issueEl.textContent = String(entries.length).padStart(3, '0');
      }
    } catch (_) { /* leave the static fallback */ }
  }
})();
