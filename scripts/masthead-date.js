/**
 * Wave 217 / Wave 256: shared masthead date + issue updater.
 * Any page with `<span id="issue-number">` and `<span id="today-date">`
 * gets the same treatment as the homepage masthead.
 *
 * Wave 256: the date now tracks the LATEST ENTRY's date (the current issue),
 * not the visitor's local clock. Entries are UTC-dated, so using new Date()
 * made the masthead lag a day for visitors behind UTC. The entry date string
 * (YYYY-MM-DD) is parsed into LOCAL parts to avoid a UTC-parse off-by-one.
 * Falls back to the visitor clock only if entries.json can't be read.
 */
(async function () {
  const dateEl = document.getElementById('today-date');
  const issueEl = document.getElementById('issue-number');
  let entries = null;
  try {
    const res = await fetch('/data/entries.json', { cache: 'no-store' });
    if (res.ok) entries = await res.json();
  } catch (_) { /* network/parse failure, fall back below */ }

  if (dateEl) {
    let d;
    if (entries && entries[0] && typeof entries[0].date === 'string') {
      const parts = entries[0].date.split('-').map(Number);
      d = new Date(parts[0], parts[1] - 1, parts[2]); // local-construct, no TZ shift
    } else {
      d = new Date();
    }
    dateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  if (issueEl && entries) {
    issueEl.textContent = String(entries.length).padStart(3, '0');
  }
})();
