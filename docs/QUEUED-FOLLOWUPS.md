# Queued Follow-ups

## "Plate N." caption bug, RESOLVED Wave 314

**Found 2026-07-23** (Christopher spotted it live: "Why does it say 'Plate N' under the images?"). `generate-daily.js` told the model to write the caption as literally `"Plate N.,"` with N a placeholder for a step that never existed, so 76 of 106 published entries shipped the placeholder visible under the photo.

**The editorial call this note asked for turned out not to be one.** The worry was that some entries were backfilled out of date order, so a naive `index+1` would mismatch publish order. `scripts/lib/plate.js` derives the number from the entry's position in *date-ascending* order, which is the right answer regardless of the order entries were written in. `scripts/sync-plate-numbers.js` (Wave 314) reconciles every stored caption against it, and renumbers rather than only filling blanks, so inserting an entry mid-archive renumbers what follows instead of leaving two Plate LXI's. It also covers article figcaptions, whose plate number is the number of the entry whose photograph the figure shows -- read from the `<img src>` filename, not typed. It runs in the chain (`scripts/reconcile.js`, step 1) on every content build. Nothing to decide; closed.

## Duplicate-subject entries flagged by site-health.js (editorial call, Christopher's)

**Found 2026-07-23** via the weekly site-health audit's "Duplicate entries" check:

- `2026-06-02 Boeing 777X` vs `2026-05-01 Thiccc Boeing` — checked both full entries side by side. These ARE a real duplicate, not just same-category variety: both definitions are literally "aircraft aft fuselage looks thicc viewed from behind," same joke, same premise, just a different specific aircraft named. Recommend: not mine to merge/delete unilaterally since both are already-published URLs (referenced in past newsletters/social posts — deleting breaks those links). Options for Christopher: (a) leave both, add a "See also" cross-link so it reads as an intentional callback rather than an accidental repeat, (b) leave as-is, it's a big catalog and one repeat joke isn't a crisis, (c) redirect one to the other (breaks the older post's specificity). Leaning (a) if asked, but this is his call.
- `2026-05-11 Champion Watermelon, Heavyweight` vs `2026-05-05 Watermelon, Moon and Stars` — checked both. These are NOT actually duplicates: one is about a heavyweight-mass cultivar (contest/scale angle), the other about a distinctly-patterned cultivar (celestial spotting angle). Different real subjects, same parent fruit — same pattern as having separate African/Asian elephant entries. site-health.js's duplicate check is same-subject-family (both "watermelon"), which is too coarse here. No action needed on the entries; maybe worth tightening the site-health duplicate heuristic later so it doesn't flag legitimate same-category variety.


Things deferred from prior sessions that should be revisited at the right time. I (Claude) will surface these when the trigger condition matches.

## FB Reel rejections - host-swap experiment ALSO failed, needs run logs

**State (2026-07-10):** every FB Reel since the Wave 280 audio fix still fails ("unable to process the media") while IG twins publish. Ruled out: file specs (H.264/AAC 44.1k stereo/faststart, 1.8MB) and browser reachability. Wave 284 added REEL_VIDEO_BASE + a .fire-reel 3rd field and re-fired Jul 7 FB-only from jsDelivr - BOTH runs failed (runs 29110632242, 29111303629, escalated to issue). Cold-CDN-cache theory disproved by the second failure.

**Next:** read those two run logs (Actions pages wedged Chrome this session; ask Christopher to paste the failing step output, or retry Actions in a fresh session). If the failure is Buffer's API rejecting the create call, the experiment never reached FB and the URL theory is untested. Consider: Buffer support ticket, or scheduling FB reels natively via Meta. The 3 dead failed cards were deleted from the queue; tomorrow's daily reel (site-hosted, default path) is the ongoing FB-side signal.

---

## Weekly Field Report quality gate failing repeatedly - 26 open issues piling up

**Found 2026-07-10:** the issues tab has ~26 open, dominated by "Weekly Field Report: quality gate failed for <date>" (07-09, 07-03, 07-02, 07-01, 06-30, 06-27...). Two problems: (a) the weekly-field-report generator's quality gate keeps failing - either the gate is miscalibrated or the generator's drafts regressed; (b) the issue-sweeper isn't closing resolved/duplicate reports, so the pile grows. Triage next session: read one issue body, run the generator locally, fix gate or generator, and teach the sweeper to dedupe this class.

---

## Image reshoot queue (one sentinel at a time)

The mechanism: write `data/.fire-image-regen.json` with `dates` and a
`subject_override`, commit, push. `regenerate-images.yml` fires on that path,
opens a PR, auto-merges, and deletes the sentinel. Since Wave 320 that workflow
runs the full reconciler chain, so a renamed photograph no longer leaves the
category hubs pointing at a file that is gone.

The override exists because the headword is not always the subject. Wave 315's
query ladder de-inverts "Crankshaft, Marine Diesel" into "Marine Diesel
Crankshaft" and falls back to "Crankshaft", which rescued two of the three
entries that had previously been unshootable. It cannot rescue an entry whose
headword is a brand nobody photographs, or one where the photograph found is of
the wrong thing rather than of nothing.

One sentinel per push. Batch mode cannot carry a per-date override, so a batch
of dates all share one query and most of them get the wrong photograph.

| Date | Entry | Problem | Override to try |
| --- | --- | --- | --- |
| 2026-05-24 | Crankshaft, Marine Diesel | **FIRED Wave 320.** Wave 319's replacement is a steam turbine rotor on trestles, not a crankshaft | `crankshaft engine` |
| 2026-05-02 | Frigidaire, Side-by-Side | All three ladder rungs returned 0 photos. Unsplash has no "Frigidaire" -- it is a brand, and the ladder cannot invent the generic noun | `side by side refrigerator stainless steel kitchen` |
| 2026-04-14 | Thick Water | Audit scores it 1/10; the photo is ocean waves. The headword is a phrase, not an object | `glass of water with spoon dysphagia`, else `gel water cup`, else `viscous liquid pouring closeup` |
| 2026-05-26 | Globe, Library Floor Model | Entry says floor model; both photos to date are desk globes. Either override or rename the entry to match what is photographable | `standing floor globe library` |
| 2026-07-22 | Kettle, Cast Iron Tea | Shares a photograph with 2026-05-12 Teapot, Cast Iron | `whistling stovetop kettle` |
| 2026-07-06 | Ball, Medicine Gym | Shares Unsplash TthLw9wNyQE with 2026-06-05 Cannonball, Naval | `medicine ball gym weight` |
| 2026-05-14 | Kettledrum, Industrial | Parked from an earlier audit | `timpani orchestra` |
| 2026-07-17 | Honeydew, Giant | Replacement rejected; needs a scale reference in frame or it reads as an ordinary melon | `honeydew melon held in hands` |

---

## Homepage static prerender frozen at May 1, RESOLVED

**Found 2026-07-10:** the served index.html showed "Friday, May 1, 2026 / Iss. 091" and Apr 27-30 entries with `href="#"` in Recently Catalogued. Client JS replaced both, so browsers were fine and crawlers saw a two-month-old paper.

**Verified fixed 2026-07-25:** index.html now ships `Iss. 106` / `Saturday, July 25, 2026` in the masthead and four real hrefs (2026-07-24 back to 2026-07-21) in Recently Catalogued. `prerender-homepage.js` runs in the chain (`scripts/reconcile.js`, step 4) on every content build, so it cannot refreeze. Closed.

---

## LLM-per-entry social captions, SHIPPED 2026-05-16 (Wave 98)

`generate-daily.js` now calls `generateSocialCaptions(entry)` after the entry is built and stores the result on `entry.socialCaptions.{morning,afternoon,evening,reels}`. Non-blocking, if the LLM step fails for any reason, post-to-buffer.js falls back to the Wave 87 templated captions. Uses gpt-4o with explicit voice exemplars (Bagger, Spruce, Hoover Dam) baked into the system prompt. Every new daily entry from this point forward ships with 4 bespoke entry-specific captions referencing real subject specifics.


---

## Submission upload pipeline, upgrade path

**Current state (as of 2026-05-09):** Submit-a-Thiccc page uses Option A, Cloudinary unsigned-upload widget feeds image URL into the existing Formspree form. Free, simple, works today.

**Why we picked it:** simplest, ~10 min total to ship, no backend work, $0.

**When to revisit:** If submission volume crosses ~5/week, OR if Christopher wants a centralized review dashboard, OR if Cloudinary free-tier limits become an issue (25GB storage / 25GB bandwidth/month).

**Upgrade options:**

### Option B, Cloudflare Pages Function + Resend email
- Submissions email Christopher with image attached
- Better than Cloudinary→Formspree two-hop because: integrated, no third-party form provider, plain email arrives in inbox
- Required: Resend free signup + 1 env var
- Estimated build: 25 min

### Option C, Pages Function + R2 + admin dashboard
- All submissions visible at /admin/submissions (Cloudflare Access-protected)
- R2 bucket stores images permanently
- Full review/triage workflow
- Required: R2 bucket setup, Cloudflare Access policy, admin page build
- Estimated build: 60 min

**Trigger to surface this:** when WAVES.md or session activity indicates submission volume is climbing.

---



## Tag taxonomy consolidation (editorial)

**Current state (2026-05-10):** 35 unique tags across 13 entries. 32 of them are used only once. Tags fail as navigation because most lead to a single entry.

Specific overlaps to consolidate:
- "fruit" + "produce" + "agriculture" + "heirloom" + "juicy", botanical group
- "vehicle" + "truck" + "aircraft" + "aviation" + "heavy-duty", transport group
- Tag "thiccc" on one entry is tautological (every entry is thiccc)
- Casing: "Italian" capitalized while others lowercase

**Recommendation:** consolidate to ~10-15 canonical tags. Each tag needs multiple entries to be useful.

**When to revisit:** an editorial decision Christopher should make. Surface this when catalog crosses 25 entries (currently 13), tag sprawl gets worse with growth.

## iPostal1 setup, SHIPPED 2026-05-16

Christopher's virtual mailbox is live: **2955 New Center Point #1023, Colorado Springs, CO 80922**. USPS Form 1583 approved, email validation complete. This unblocks the trademark filing (`legal/TRADEMARK-APPLICATION-DRAFT.md` now has the real address + phone wired in).


## Image-regen for Banana Cavendish, FIRED 2026-05-21 (post-Wave-195)

Sentinel pushed with `subject_override: "single ripe banana close up macro food photography"`. Workflow opens a PR; Christopher merges or rejects via admin panel. If PR doesn't appear within ~5 min of commit landing, the regenerate-images.yml workflow itself is broken.

---

## Cloudflare Analytics install — RESOLVED, already live

**Found 2026-07-23:** contrary to the note below, Web Analytics IS installed and collecting real data — 400 visits over the last 21 days, Core Web Vitals breakdown by page, all visible in the admin@thiccctionary.com Cloudflare account (Analytics → Web analytics). No action needed. (Leaving the stale note below for history/context only — someone must have installed it between 07-10 and now without logging it here.)

~~**Current state:** Not installed. Site has zero baseline traffic data.~~
~~**When to revisit:** Christopher's first available 5-min window. The walkthrough is queued.~~

---

## Archive page CLS (footer jumps 0.366), SHIPPED 2026-07-23

**Found 2026-07-23**, using the Web Analytics data above: Core Web Vitals overall are good (LCP 76% good, INP 100% good) except CLS, and `/archive` is the one page scoring 100% Poor. Cloudflare's Debug View pins it to one element: `html>body>footer.footer`, CLS 0.366 (threshold for "good" is <0.1).

**Root cause (confirmed via archive.html source):** `#archive-grid` starts empty in the static HTML and is populated client-side by `render()` in archive.html's inline script — it fetches entries.json and injects ~193 `.recent-card` divs after page load. Because the grid has no reserved height beforehand, the sudden ~193-card injection pushes everything below it (the footer) down in one jump — classic CLS from unreserved dynamic content.

**Fix (shipped, commit `fe8f52a`):** `#archive-grid` now ships 12 skeleton placeholder `.recent-card--skeleton` divs in the static HTML (matching real card dimensions) so the grid isn't empty on first paint; `render()` still swaps in the real cards once entries.json resolves. Styling added to `styles.css`/`styles.min.css`. Not yet re-measured in Web Analytics (CLS data lags a few days) — worth a follow-up check next time Web Analytics is open to confirm it actually dropped out of "100% Poor."

---

## Trademark filing, SHIPPED 2026-05-16 (Wave 103)

Application **filed**. Serial number **99827994**. Class 041, Section 1(a), $350 paid. Now awaiting USPTO examining attorney review (~3-4 months).

Next watch: an "office action" may arrive within 6 months. If it's a descriptiveness or specimen issue, we respond DIY. If it's substantive (e.g., USPTO argues THICCCTIONARY is "merely descriptive" of a dictionary about thiccc things), we may want an attorney for the response (~$500-1000).

Status tracking: https://tsdr.uspto.gov/#caseNumber=99827994


## Brand-mention monitoring workflow

**Current state:** Not built. Google Alert set up by Christopher today as a manual backstop.

**When to revisit:** Anytime, fully autonomous build. ~30 min, uses Bing Search API or similar.

---

## Buttondown newsletter, already working, just needs verification it sent today

**CORRECTION 2026-05-10 (post-Wave 75):** I previously told Christopher no newsletter pipeline existed. That was wrong. `scripts/send-newsletter.js` POSTs to Buttondown's API to publish + send the day's entry on every PR merge. It runs as the last step of `post-on-merge.yml`. So when Christopher merges a daily PR, subscribers automatically get an email with the entry's word, image, definitions, etymology, and a link.

**Current state:** the pipeline exists and fires automatically. The Wave 71 copy "Get the next one in your inbox" is now truthful as long as `send-newsletter.js` succeeds. The thing I don't know is whether today's Bagger 288 newsletter actually delivered, that requires Christopher to check his Buttondown dashboard or his own inbox.

**What to verify next session:** Did the 2026-05-10 newsletter actually land in Christopher's inbox? If yes, this entire item closes. If no, debug `send-newsletter.js`.

**RSS-to-email is NOT needed** unless we 
---

## Mobile app, interactive Thiccctionary (queued for design)

**Christopher's note 2026-05-16:** Wants a mobile app "very interactive", not just a re-skin of the website.

**What this implies trademark-wise:** When the app ships, we'll need a **separate Class 9** trademark filing (`$350`, can use the existing Section 1(a) basis once the app is in actual use). Class 41 (current filing, serial 99827994) only covers the online service. The app is downloadable software, a different USPTO class.

**Interactive ideas worth considering when design starts:**
- Tap-to-rate ("Is It Thiccc?" classifier built natively)
- Daily-entry as the launch screen with swipe-archive behind it
- Augmented reality "scan a thing → is it thiccc?" mode (computer vision via on-device model)
- Streak/collection mechanic (unlock badges for spotting certain categories)
- Native share-to-Instagram-Story flow with the entry as overlay
- Native push notification on daily-entry drop
- Offline-first reading of the catalog (caches recent entries on first launch)

**Tech stack considerations (not decisions, just options):**
- React Native + Expo, fastest to ship, single codebase iOS+Android
- Native Swift + Kotlin, best UX, slowest to ship, double the effort
- PWA upgrade of existing site, cheapest, weakest "real app" signal

**When to revisit:** Once catalog hits ~50 entries (~mid-2026) AND we have first-mention press coverage. App needs critical mass of content + audience to justify the development effort.

---

## CRITICAL: daily.yml not consuming sentinels (2026-05-30, found by Director)

**Symptom:** 5 missing daily entries in the catalog:
- 5/25, 5/26, 5/27, 5/28: cron generated "Sequoia, General Sherman" 4 times (picker stuck); Christopher closed 4 duplicate PRs. Only 5/29 Sequoia made it to main. The other 4 dates have no entry.
- 5/30 (today): `.fire-daily` sentinel was pushed 3 times by outcome-verify; no daily PR or entry resulted. Daily.yml is not converting sentinels into entries.

**What I did this session (Wave 219 post-script):**
1. Bumped `.fire-daily` with a marker comment and pushed again to retrigger workflow path filter.
2. Padded `data/subject-queue.json` from 1 -> 6 items so the auto-picker can't fall back to Sequoia again.

**Next-session priorities (in order):**

1. **Pull GH Actions logs for daily.yml runs since 2026-05-30 16:00 UTC** and find the actual failure mode. Three sentinel-fires today produced zero successful entries. Either:
   - Workflow isn't triggering on `data/.fire-daily` push (check `paths:` filter behavior with sentinel rewrites)
   - Workflow triggers but `generate-daily.js` fails before sentinel-consume step
   - Concurrency cancel-in-progress is killing each retry before it finishes

2. **Backfill 5/25, 5/26, 5/27, 5/28 with distinct subjects.** Suggested picks (avoiding catalog dupes):
   - 5/25: Boulder, Glacial Erratic
   - 5/26: Locomotive, Big Boy 4014
   - 5/27: Iceberg, Tabular
   - 5/28: Cargo Ship, Ever Given
   
   Mechanism: extend `daily.yml` (or a new `backfill-entry.yml`) to accept `target_date` + `subject_override` inputs, OR hand-write 4 entries to `entries.json` and rebuild HTML pages.

3. **Fix `pendingPrWords()` so closed-but-not-merged duplicates count as "used."** Today's bug: 4 separate `daily/2026-05-XX` branches all generated Sequoia. Christopher closed them WITHOUT merging. The next day's `pendingPrWords()` only looks at OPEN `daily/*` refs, so once closed, the duplicate signal vanished and the picker re-picked Sequoia next day. Either: (a) also read CLOSED PRs from the last 7 days, OR (b) write rejected subjects to `audits/dead-subjects/<date>.md` on PR close.

4. **Investigate why the queue was empty before today.** queue head was Anchor today (good), but at no point during 5/25-5/29 did any queued subject get picked. Either the queue was emptied earlier or `refill-subject-queue.js` is dumping the queue and the auto-picker is winning. Verify queue-priority in `generate-daily.js`.

5. **Image regen for Banana Cavendish** (fired 5/21, no PR seen) is still pending verification.

**Why this matters:** Catalog has a visible 4-day gap (5/25-5/28). The publication's whole conceit is "daily." A 4-day gap on a 40-entry catalog is a 10% miss. Foundation is leaking.

---

## Wave 220+: weekly auto-generated grievance column

**Direction (Christopher 2026-05-30):** "Maybe make the HR bit bigger? It's currently pretty deep in the links. I think it's funny and develops the characters. Your call."

**Wave 220 shipped (this session):**
- Homepage tile: "Filed With HR" feature box between Verdict Ledger and Newsletter sections, showing Grievance No. 31 (the coffee machine) with Constance's response, linking to full Personnel File.
- /about/documents/ index reordered: Personnel File now position 2 (after Style Guide), highlighted with oxblood border.
- Personnel File added as a tile in the "From the Editorial Desk" article grid on homepage.

**Next wave (NOT shipped):** auto-generate a NEW grievance each week. Same playbook as Mailbag (Wave 210):
- New script `scripts/generate-grievance.js` -- calls Claude with Bart-files-something + Constance-responds-in-HR-speak prompt. Pulls from a bank of grievance topics + her response patterns.
- New workflow `.github/workflows/grievance.yml` running Tuesdays 14:00 UTC (Mailbag is Wednesdays, so they stagger).
- Append generated entries to `about/documents/personnel-file/index.html` (or migrate to a JSON-fed file and rebuild the HTML).
- Rotate the homepage "Filed With HR" tile to feature the LATEST grievance, not a hardcoded one.
- Add an `data/.fire-grievance` sentinel + admin force button for manual fires.

**Topic bank to seed (8 ideas):**
1. The motion-sensor lights in the editorial office turn off when Bart is reading
2. A spelling correction was made to a memo without prior authorization
3. The Q3 review of the coffee machine has been re-deferred to Q1 next year
4. Someone added a houseplant to the Senior Cataloguer's window sill ("a windowsill is not, by any defensible reading, a planter")
5. The new submission form has a confirmation page that says 'Yay!'
6. A Slack workspace has been registered in the publication's name; the Senior Cataloguer was not consulted
7. The fire drill on the third Tuesday is unnecessary in a publication on the second floor
8. A "team-building lunch" was scheduled; the Senior Cataloguer is opposed in principle

**Why hold this for next session:** The 5/30 cron failure + 4-day catalog gap is higher priority than another auto-generation pipeline. Build the column after foundation is fixed.


## Rewrite "A Note from the Editors", queued 2026-06-04

Christopher 2026-06-04: *"Something for later, let's rewrite the note from the editors."*

Lives on:
- `index.html` (homepage About section, h3 "A Note from the Editors")
- `about/index.html` (full-page version, h2 "A Note from the Editors")

The current copy is functional but a bit defensive (heavy on the "rules are not negotiable" framing). A rewrite should:
- Keep the "satire of a specific cultural habit + applied to literally anything but bodies" brand promise
- Lean into the editorial-board voice that has been working in Filed Replies and From the Boat
- Reference the masthead cast (or at least Bertram, the publisher) as the source of the note
- Probably shorter, drier, more institutional

**Trigger to act:** when Christopher asks, or in a focused unattended session when no other editorial work is pending.

## Auto-add registered articles to sitemap.xml, SHIPPED Wave 303/303b

**Was:** every new column's URL had to be added to sitemap.xml by hand; Wave 263's site-health guard flagged the gap but did not close it.

**Now:** `scripts/sync-sitemap.js` is the single owner of sitemap.xml. It guarantees a `<url>` for every entry in entries.json, every article in articles.json and every page on the static allowlist, drops everything on the exclude list, and never removes a URL it does not own. Wave 303b removed the competing hardcoded 20-page rewrite in `build-entry-pages.js` that had been silently reverting it. Wave 316 added noindex detection, so a page declaring `robots: noindex` is excluded rather than listed and ignored. It runs in the chain (`scripts/reconcile.js`, step 10) and supports `--check` for CI. Closed.


## Reference-document PDFs drift from their pages

**Observed 2026-07-10 (Wave 287):** about/documents/personnel-file/personnel-file.pdf is a static file from the seven-grievance era; the page now holds 18 grievances + 11 alignment minutes. Other doc PDFs likely drift the same way as pages evolve.

**Fix when picked up:** generate the PDFs from the live pages in the build (headless render or a doc-to-pdf script), or regenerate manually after material page changes and add a site-health check comparing PDF mtime/size against page changes.

**Trigger:** any session touching the reference documents, or if Christopher mentions the PDFs.
