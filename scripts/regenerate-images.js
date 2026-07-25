/**
 * Re-runs Unsplash image search + AI vision pick for existing entries,
 * replacing their images with picks made by the tuned prompt. Also
 * rebuilds each updated entry's per-entry HTML page + the sitemap so
 * the static pages reference the new image paths.
 *
 * Triggered by .github/workflows/regenerate-images.yml (manual only).
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - UNSPLASH_ACCESS_KEY
 *   - DATES (optional)            comma-separated YYYY-MM-DD dates. Default: every entry except today.
 *   - SUBJECT_OVERRIDE (optional) hand-picked search query to try FIRST for these dates.
 *                                  Useful when entry.word returns wrong-subject Unsplash results.
 *                                  As of Wave 326 it leads the ladder rather than replacing it, so
 *                                  a phrase that returns zero photos falls back to the headword
 *                                  rungs instead of ending the run. Pipe-separate to supply several
 *                                  rungs of your own: "timpani orchestra|timpani|orchestral drum".
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { critiqueImage, passesGate, GATES, formatCritique } from './image-critic.js';
import { fileURLToPath } from 'node:url';
import { buildEntryPage, buildSitemap } from './build-entry-pages.js';
import { usedPhotoIds, filterUsedPhotos } from './lib/used-photos.js';
import { writeEntries } from './lib/entries-io.js';
import { queryLadder } from './lib/search-queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const IMAGES_DIR = path.join(ROOT, 'images');

/**
 * Wave 309: leave evidence in the repo, because the Actions log is unreadable
 * from where the agent lives.
 *
 * Wave 306b dispatched a regen of eight wrong-subject photos. The sentinel was
 * consumed, so the workflow definitely ran. No PR branch ever appeared, and
 * that single fact is consistent with at least four different outcomes:
 * the critic declined all eight, Unsplash 401'd on a dead key, OpenAI ran out
 * of credit, or the script threw somewhere else. `process.exit(1)` on
 * (failed > 0 && succeeded === 0) skips the "Open Pull Request" step, so a
 * total failure and a total no-op are indistinguishable from outside -- both
 * are silence. Twenty minutes of polling `git branch -r` cannot tell them
 * apart, and neither can any amount of reasoning.
 *
 * So the run now writes down what happened. audits/regen-last-run.md is
 * committed by the workflow with `if: always()`, which means it survives the
 * non-zero exit that hides everything else. One `git fetch` and the answer is
 * in the repo.
 */
const RUN_LOG = { dates: '', override: '', fatal: null, rows: [] };

function logRow(date, word, outcome, detail) {
  RUN_LOG.rows.push({ date, word, outcome, detail: detail || '' });
}

async function writeRunLog() {
  const counts = RUN_LOG.rows.reduce((a, r) => (a[r.outcome] = (a[r.outcome] || 0) + 1, a), {});
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing processed';
  const lines = [
    '# Last image-regen run',
    '',
    'Written by scripts/regenerate-images.js and committed by the workflow with',
    '`if: always()`, so it exists even when the run exits non-zero and opens no PR.',
    '',
    `- **Run:** ${process.env.GITHUB_RUN_ID ? `[${process.env.GITHUB_RUN_ID}](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})` : 'local'}`,
    `- **Dates requested:** \`${RUN_LOG.dates || '(none)'}\``,
    `- **Subject override:** \`${RUN_LOG.override || '(none)'}\``,
    `- **Result:** ${summary}`,
    '',
  ];
  if (RUN_LOG.fatal) {
    lines.push('## Fatal error', '', '```', String(RUN_LOG.fatal).slice(0, 4000), '```', '');
  }
  lines.push('| Date | Word | Outcome | Detail |', '| --- | --- | --- | --- |');
  for (const r of RUN_LOG.rows) {
    const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300);
    lines.push(`| ${r.date} | ${cell(r.word)} | **${r.outcome}** | ${cell(r.detail)} |`);
  }
  lines.push('');
  try {
    await fs.mkdir(path.join(ROOT, 'audits'), { recursive: true });
    await fs.writeFile(path.join(ROOT, 'audits', 'regen-last-run.md'), lines.join('\n'));
    console.log('Wrote audits/regen-last-run.md');
  } catch (e) {
    console.error('Could not write run log:', e.message);
  }
}

// Wave 310: every network call gets a deadline. The Wave 309b run sat in the
// "Regenerate images" step for 45+ minutes with eight entries to do and never
// produced a log, because a hung fetch has no natural end and the job had no
// timeout either. A request that has not answered inside its budget is a
// failure we can name, not a wait to be endured.
const NET = { search: 30_000, vision: 90_000, download: 60_000, ping: 15_000 };

/** fetch() with a deadline, and an error message that says which call died. */
async function fetchDeadline(url, opts, ms, label) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`${label} timed out after ${ms / 1000}s`);
    }
    throw new Error(`${label} failed: ${e.message}`);
  }
}

async function searchUnsplash(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape&content_filter=high`;
  const res = await fetchDeadline(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  }, NET.search, `Unsplash search "${query}"`);
  if (!res.ok) throw new Error(`Unsplash search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.results.map(r => ({
    id: r.id,
    description: r.description || r.alt_description || '',
    fullUrl: r.urls.regular,
    thumbUrl: r.urls.small,
    photographer: r.user.name,
    photographerUrl: r.user.links.html,
    unsplashUrl: r.links.html,
    downloadLocation: r.links.download_location,
  }));
}

async function pickThiccestImage(subject, candidates) {
  const subset = candidates.slice(0, 12);
  const imageMessages = subset.map(c => ({
    type: 'image_url',
    image_url: { url: c.thumbUrl, detail: 'low' },
  }));

  const sysPrompt = `You evaluate photos for "Thiccctionary," a satirical site about THICK objects. Your goal: pick the photo where the subject's overall girth and silhouette are most obvious to someone seeing it for the first time.

CRITICAL, the photo MUST show the WHOLE subject in frame:
- The full silhouette must be visible, head to tail, end to end
- A reader should be able to see the subject's overall shape at a glance
- REJECT tight crops, detail shots, side panels, single wheels, engine close-ups, or any composition where you can only see PART of the subject
- If NONE of the candidates show the full subject, pick the one with the most of it visible

Avoid:
- Photos that include people, bodies, body parts, or hands
- Photos that look like marketing/product renders or illustrations
- Photos with watermarks or text overlays
- Photos where the subject is too small, obscured, or in deep shadow
- Detail shots focused on engineering parts rather than overall form

Prefer:
- Rear three-quarter angles, side profiles, or back views that show the FULL subject silhouette and emphasize girth
- Isolated subjects against clean backgrounds with good separation from clutter
- Natural light, especially golden hour
- Vintage / weathered / character-rich examples`;

  const userPrompt = `Subject: ${subject}

Below are ${subset.length} candidate photos numbered 1 through ${subset.length}. Pick the one most fitting for a satirical "thicc" entry about this subject.

Output JSON only:
{
  "pick": <integer 1-${subset.length}>,
  "reason": "one short sentence on why this photo is the thiccest"
}`;

  const res = await fetchDeadline('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageMessages] },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  }, NET.vision, 'OpenAI vision pick');
  if (!res.ok) throw new Error(`Vision pick failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const result = JSON.parse(data.choices[0].message.content);
  const idx = Math.max(1, Math.min(subset.length, result.pick)) - 1;
  console.log(`  Vision picked #${idx + 1}: ${result.reason}`);
  return subset[idx];
}

async function downloadImage(photo, filename) {
  const res = await fetchDeadline(photo.fullUrl, {}, NET.download, 'Image download');
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, filename), buf);
  await fetchDeadline(photo.downloadLocation, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  }, NET.ping, 'Unsplash download ping').catch(() => {});
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !process.env.UNSPLASH_ACCESS_KEY) {
    console.error('OPENAI_API_KEY and UNSPLASH_ACCESS_KEY are required.');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  const datesInput = (process.env.DATES || 'all-except-today').trim();
  let toProcess;
  if (datesInput === 'all-except-today' || datesInput === '') {
    toProcess = entries.filter(e => e.date !== today);
    console.log(`Processing all entries except today (${today}). ${toProcess.length} entries.`);
  } else {
    const dates = datesInput.split(',').map(s => s.trim()).filter(Boolean);
    toProcess = entries.filter(e => dates.includes(e.date));
    console.log(`Processing ${toProcess.length} entries (dates: ${dates.join(', ')}).`);
  }

  if (toProcess.length === 0) {
    console.log('Nothing to process.');
    RUN_LOG.dates = datesInput;
    RUN_LOG.fatal = `No entry matched DATES="${datesInput}". Nothing ran.`;
    await writeRunLog();
    return;
  }

  RUN_LOG.dates = datesInput;
  const override = (process.env.SUBJECT_OVERRIDE || '').trim();
  RUN_LOG.override = override;
  if (override) {
    console.log(`SUBJECT_OVERRIDE active: "${override}" leads the query ladder for all selected dates (headword rungs remain behind it as fallbacks; pipe-separate to supply your own rungs).`);
  }

  let succeeded = 0;
  let failed = 0;
  // Bug fix (2026-07-24): "no Unsplash results" and "critic rejected every
  // candidate" are NORMAL no-op outcomes -- the quality gate did its job and
  // declined to swap in a worse photo. They used to count as `failed`, so the
  // job exited 1, which auto-escalated a CI-failure GitHub issue every time
  // (that is what issues #184 and #195 actually are). Track them separately so
  // only genuine errors (network/API/exception) fail the run.
  let skipped = 0;

  for (const entry of toProcess) {
    console.log(`\n--- ${entry.date}: ${entry.word} ---`);
    try {
      // Wave 314: the only fallback used to be "strip the word thiccc", which
      // does nothing for a headword that never contained it. 96 of 106
      // headwords are written in dictionary inversion ("Crankshaft, Marine
      // Diesel"), which is the right form for an archive and an unsearchable
      // one for a photo library -- three entries could not be reshot at all
      // because of it. The ladder de-inverts, then falls back to the head noun.
      const ladder = queryLadder(entry.word, override);
      const primaryQuery = ladder[0];
      let candidates = [];
      let usedQuery = primaryQuery;
      for (const q of ladder) {
        candidates = await searchUnsplash(q);
        console.log(`  Searched "${q}" -> ${candidates.length} results.`);
        if (candidates.length) { usedQuery = q; break; }
      }
      if (candidates.length === 0) {
        console.log(`  No Unsplash results for any of ${ladder.length} quer(y/ies) -- skipping.`);
        logRow(entry.date, entry.word, 'no-results', `tried ${ladder.map(q => `"${q}"`).join(', ')}, all returned 0 photos`);
        skipped++;
        continue;
      }
      if (usedQuery !== primaryQuery) console.log(`  Fell back to "${usedQuery}".`);
      // Wave 306: exclude photos other entries already use. `spentPhotos` is
      // rebuilt per entry from the catalog minus this entry, so a regen that
      // ends up re-choosing its own current photo is still allowed -- the point
      // is to stop it stealing a NEIGHBOUR's.
      const spentPhotos = usedPhotoIds(entries.filter(e => e.date !== entry.date));
      candidates = filterUsedPhotos(candidates, spentPhotos, m => console.log('  ' + m));

      const subjectForVision = override || entry.word;
      let chosen = null;
      let critique = null;
      let lastReject = 'none recorded';
      // Wave 204: critic gate. Up to 3 picks from this candidate set; reject any
      // that fail the subject-prominence test (score>=7, subject>=25%% of frame).
      const tried = new Set();
      for (let attempt = 1; attempt <= 3 && !chosen; attempt++) {
        const remaining = candidates.filter((_, i) => !tried.has(i));
        if (remaining.length === 0) {
          console.log('  All candidates exhausted by critic; giving up on this entry.');
          break;
        }
        const candidate = await pickThiccestImage(subjectForVision, remaining);
        const candidateIdx = candidates.indexOf(candidate);
        tried.add(candidateIdx);
        const c = await critiqueImage({
          subject: subjectForVision,
          imageUrl: candidate.fullUrl,
          photoDescription: candidate.description,
          photographer: candidate.photographer,
        });
        if (passesGate(c, GATES.regen)) {
          chosen = candidate;
          critique = c;
          if (c) console.log(`  Critic PASS (attempt ${attempt}/3): ${formatCritique(c)}`);
        } else {
          // Wave 321: name the identity failure explicitly. A run log reading
          // only "score=4" invites another query tweak; one reading
          // "not the subject" says the query was fine and the photo was not.
          // Wave 325 adds the stranger's answer, which is the line that would
          // have caught the Frigidaire-that-was-a-kitchen on sight.
          lastReject = formatCritique(c);
          console.log(`  Critic REJECT (attempt ${attempt}/3): ${lastReject}. Trying next.`);
        }
      }
      if (!chosen) {
        console.log('  No candidate passed the critic gate. Skipping this entry.');
        logRow(entry.date, entry.word, 'critic-rejected',
          `${candidates.length} candidates, 3 attempts, last verdict: ${lastReject}`);
        skipped++;
        continue;
      }
      // New convention: include slug so old URLs stop resolving on revert.
      const slug = String(entry.word).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      let filename = `${entry.date}-${slug}.jpg`;
      // Wave 301: if the regen would reuse the exact same filename, the CDN edge
      // keeps serving the old bytes (observed 2026-07-18 on the 07-15 entry).
      // Suffix a short version stamp so the entry HTML points at a fresh URL.
      const prevPath = entry.image ? entry.image.replace(/^\.?\//, '') : null;
      if (prevPath === `images/${filename}`) {
        const stamp = Date.now().toString(36).slice(-4);
        filename = `${entry.date}-${slug}-${stamp}.jpg`;
      }
      await downloadImage(chosen, filename);
      console.log(`  Saved new image: images/${filename}`);

      // Wave 183: generate WebP next to the JPEG. Non-blocking.
      try {
        const { execSync } = await import('node:child_process');
        execSync(`node scripts/jpg-to-webp.js images/${filename}`, { cwd: ROOT, stdio: 'inherit' });
      } catch (e) {
        console.warn(`  WebP generation failed (non-fatal): ${e.message}`);
      }
      // If the entry previously pointed at a date-only filename, remove the
      // stale file so the repo doesn't accumulate orphans.
      const previousImage = entry.image && entry.image !== `images/${filename}` ? entry.image.replace(/^\.?\//, '') : null;
      if (previousImage && previousImage !== `images/${filename}`) {
        // Bug fix (2026-07-24): this only unlinked the stale .jpg and left the
        // matching .webp behind, so every version-stamped regen orphaned a WebP
        // in the repo (confirmed: 2026-05-23-anvil-blacksmith.webp survived its
        // own regen). Remove both siblings.
        for (const stale of [previousImage, previousImage.replace(/\.jpe?g$/i, '.webp')]) {
          try {
            await fs.unlink(path.join(ROOT, stale));
            console.log(`  Removed stale image: ${stale}`);
          } catch (e) { /* file already absent, fine */ }
        }
      }

      entry.image = `images/${filename}`;
      entry.photographer = chosen.photographer;
      entry.photographerUrl = chosen.photographerUrl;
      entry.unsplashUrl = chosen.unsplashUrl;
      logRow(entry.date, entry.word, 'replaced',
        `images/${filename} <- ${chosen.unsplashUrl} (${formatCritique(critique)})`);
      succeeded++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      logRow(entry.date, entry.word, 'error', err.message);
      failed++;
    }

    // Wave 310: flush after every entry, not just at the end. If the job is
    // killed mid-run the file on disk still names how far we got.
    await writeRunLog();
    await new Promise(r => setTimeout(r, 1500));
  }

  await writeEntries(ENTRIES_PATH, entries);

  console.log('\nRebuilding entry HTML pages...');
  for (const entry of toProcess) {
    try {
      const idx = entries.findIndex(e => e.date === entry.date);
      const updated = idx !== -1 ? entries[idx] : null;
      if (updated) {
        // Bug fix (2026-07-24): this used to call buildEntryPage(updated) with
        // only one argument, so prev/next/allEntries all defaulted to null --
        // buildEntryPage() then silently rendered an empty prev/next nav AND
        // an empty "Related entries" section on every page this workflow ever
        // touched (confirmed across all prior regenerate-images runs). Mirror
        // the same prev/next math build-entry-pages.js's own driver uses:
        // entries.json is sorted newest-first, so "next" (newer) = entries[i-1]
        // and "prev" (older) = entries[i+1].
        const next = idx > 0 ? entries[idx - 1] : null;
        const prev = idx < entries.length - 1 ? entries[idx + 1] : null;
        await buildEntryPage(updated, prev, next, entries);
        console.log(`  Rebuilt entries/${entry.date}.html`);
      }
    } catch (err) {
      console.error(`  Failed to rebuild ${entry.date}.html: ${err.message}`);
    }
  }
  await buildSitemap(entries);
  console.log('  Sitemap rebuilt.');

  // Bug fix (2026-07-24): the homepage and the /is/<word>-thiccc/ pages embed
  // the same image src as the entry page, but this script only ever rebuilt
  // entries/*.html -- so after any regen they kept pointing at the old
  // filename and smoke-test-visual.js failed with img-missing. Observed twice
  // in one day (2026-07-24 mango, 2026-05-23 anvil). Rebuild them here so the
  // workflow's PR is self-consistent instead of needing a manual follow-up.
  const { execSync } = await import('node:child_process');
  for (const script of ['prerender-homepage.js', 'build-is-pages.js']) {
    try {
      execSync(`node scripts/${script}`, { cwd: ROOT, stdio: 'inherit' });
      console.log(`  Rebuilt via ${script}`);
    } catch (e) {
      console.warn(`  ${script} failed (non-fatal): ${e.message}`);
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${skipped} skipped (quality gate), ${failed} failed (out of ${toProcess.length}).`);
  if (succeeded === 0 && skipped > 0 && failed === 0) {
    console.log('No entry was updated: the critic declined every candidate. That is a clean');
    console.log('no-op, not a failure -- rerun with a different SUBJECT_OVERRIDE query.');
  }
  await writeRunLog();
  if (failed > 0 && succeeded === 0) {
    process.exit(1);
  }
}

main().catch(async err => {
  // A throw outside the per-entry try -- entries.json unreadable, a bad DATES
  // value, an exception in the post-processing rebuild -- used to leave nothing
  // behind at all. Record it, then fail as before.
  console.error(err);
  RUN_LOG.fatal = err && err.stack ? err.stack : err;
  await writeRunLog();
  process.exit(1);
});
