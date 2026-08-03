# Queued Follow-ups

## Instagram reels silently vanishing after Buffer accepts them (found 2026-08-03)

`post-on-merge.yml` run #80 (2026-08-02 evening) posted today's (08-03) reel. The log shows `OK channel 69f62e0e5c4c051afa033677 (post id: 6a702846aacd241cfdb659b9)` -- Buffer's `createPost` mutation returned a `PostActionSuccess` with a real post id for the IG channel, same as it did for FB. FB's copy is live (verified in Buffer's Sent tab, 9:46 AM MDT). IG's copy does not exist anywhere in Buffer: Queue=0, no "Not Published" error banner (FB's stuck Jul 30/Aug 1 reels DO show a visible red banner for the same class of failure), and IG's most recent Sent post is from the day before, not today.

Checked and ruled out: IG channel posting schedule is on, queue is not paused, no visible disconnect/reconnect warning in channel settings.

Leading theory: Buffer/Meta validates video asynchronously after `createPost` returns, and IG's async-failure path drops the post silently while FB's leaves a visible banner. Not confirmed -- would need a verify-after-post query (`scripts/buffer-queue.js` already has a working `posts(input: {filter: {channelIds, status}})` query shape with an `error { message }` field on each post node) run ~60s after the reels post-to-buffer step, filtered to `status: [errored, failed]` for the IG channel, to catch this with evidence instead of guessing. Not shipped 2026-08-03 -- didn't want to guess at untested GraphQL shapes against the live daily cron; the query shape needs to be proven against a real errored post first, ideally in a session with API/Chrome access to iterate quickly.

If this has been happening beyond just today, it plausibly explains any IG follower/engagement stagnation independent of content quality -- worth prioritizing over further reel creative work until confirmed one way or the other.

**Trigger:** next session with Chrome/Buffer access -- watch tomorrow's IG reel the same way (post-on-merge.yml log post id + Buffer Sent tab) to see if it's a every-day pattern or one-off; if it recurs, build the verify-after-post check.

## GitHub PAT expired 2026-08-03 -- needs Christopher's regeneration

`git push` failed with "Invalid username or token" this session (clone/read still worked at session start, so it crossed its expiration boundary mid-session or the read/write paths validate differently). This was flagged as due ~2026-08-02 in three straight prior sessions. Every autonomous git-push workflow is now blocked until regenerated. This session's fixes shipped via the GitHub web editor instead (Chrome was available), which works for small text-file edits but doesn't scale to larger changes or binary files.

**Trigger:** Christopher runs `SETUP_GITHUB_TOKEN.bat` or regenerates at github.com/settings/tokens (Fine-grained tokens tab), then updates `.gh-token` on disk. Next session should save the fresh token to `secret_github_pat.md` per that file's own instructions.

## 6 stale "Regenerated images" PRs open a week+ despite green checks (found 2026-08-03)

PRs #199-207 (image regen bot PRs) are all open, all have a green checkmark, none have merged. Not investigated this session (time-boxed) -- worth checking whether the auto-merge workflow ("Auto-resolve PR conflicts") is actually running against these, or whether they need a manual merge / are stuck on a check that isn't visible from the PR list view.

**Trigger:** next session with a few spare minutes -- open one PR, check its merge status/checks in detail, decide auto-merge-fix vs. manual-merge-once vs. close-as-stale.

## Real catalog gap: 2026-08-01 has no entry -- target_date wiring SHIPPED (Wave 333), backfill NOT yet dispatched

**Found 2026-08-02** while chasing why `reel-video-yesterday` kept failing in outcome-verify: the recovery attempt errored `No entry for 2026-08-01` from `build-tiktok-video.js`. Checked `data/entries.json` and `entries/` directly -- confirmed, there is no 2026-08-01 record and no `entries/2026-08-01.html`. The homepage's "Recently Catalogued" rail jumps straight from Jul 31 to Aug 2.

**What happened:** `outcome-verify.yml`'s daily-entry recovery step fired the `.fire-daily` sentinel + `workflow_dispatch daily.yml` **six times** across 2026-08-01 (commits 682fd71, 93620fc, 9957935, ee4ca14, ee8b174, 5a7acac) trying to recover the missing entry, and every attempt still failed to land one -- no `audits/failed-runs/` or `audits/dead-subjects/` entry exists for any of those runs, so the actual error was never captured (a second gap: the failure-handler that caught today's TikTok failure apparently isn't wired to every `daily.yml` failure mode). By the time 2026-08-02's cron ran and succeeded, `outcome-verify` only checks *today's* date, so it stopped complaining -- 08-01 was silently left behind for good.

**Why it wasn't backfilled this session:** `generate-daily.js` already honors a `TARGET_DATE` env var (confirmed by reading the source, line ~718/739) but `daily.yml` never wires it through anywhere -- the workflow always generates for the literal system date, and its `workflow_dispatch` only accepts `force_regenerate` (boolean, today only). There's no way to ask the live daily pipeline for a specific past date without editing the workflow. I chose not to hand-edit `daily.yml` (the live cron every other day depends on) without being able to test the change first -- and I have no OpenAI/Anthropic/Unsplash keys in this sandbox to run `generate-daily.js` locally, so hand-fabricating the entry content myself was the only alternative, which fails the same quality/editorial-sanity bar that sank the fabricated "Kettle, Industrial F350" entry in May. A rushed low-quality entry to fill a date is worse than a visible gap.

**Fix shape for next session (or Christopher, if he wants it sooner):**
1. Add a `target_date` input to `daily.yml`'s `workflow_dispatch` (string, optional). When set, pass it as `TARGET_DATE` env to the generate step and use it (not `date -u +%Y-%m-%d`) in the "Skip if today's entry already exists" collision check.
2. Test the change on a **workflow_dispatch dry run for a date that doesn't collide** (e.g. re-target today with `force_regenerate` still working) before trusting it against a live gap.
3. Then dispatch it once for `2026-08-01` with a subject that doesn't collide with anything already catalogued (check `data/entries.json` first -- avoid repeating May's Sequoia-dup class of bug).
4. Also worth fixing while in there: wire `daily.yml`'s own failure paths into the same `audits/failed-runs/` handler that already caught today's TikTok failure, so the NEXT six-sentinel-fires-no-progress loop leaves a diagnosable trail instead of nothing.

**Update 2026-08-02 (Wave 333):** shipped the `target_date` wiring from step 1 above. `daily.yml`'s `workflow_dispatch` now accepts an optional `target_date: string` input; when set it overrides `date -u +%Y-%m-%d` in the collision check, the `TARGET_DATE` env passed to `generate-daily-with-retry.js` (already reads `process.env.TARGET_DATE || today()`, confirmed in source), the "Verify entry actually changed" check, and the PR metadata step. When the input is empty/unset (every `schedule` and `push` trigger, and any `workflow_dispatch` that doesn't set it), all four spots fall through to the exact same `date -u +%Y-%m-%d` as before -- verified by reading `${{ inputs.target_date }}` renders as empty string outside `workflow_dispatch`, so `[ -n "" ]` is false. Confirmed via `python3 -c "import yaml; yaml.safe_load(...)"` that the YAML still parses. **NOT dispatched or live-tested** -- this sandbox has no `gh` CLI and `api.github.com` is proxy-blocked (403), so I cannot fire `workflow_dispatch` or read run logs myself. Step 2's dry-run and step 3's actual `2026-08-01` backfill both still need a session with either Chrome (drive the Actions tab UI) or Christopher dispatching it directly: Actions -> "Daily Thiccc, Generate Draft PR" -> Run workflow -> target_date=`2026-08-01`, force_regenerate=false (2026-08-01 doesn't exist yet so the collision check will proceed on its own).

**New hypothesis for gap #4 (why the 6 retry attempts left no failure trace):** `daily.yml` has `concurrency: group: daily-cron, cancel-in-progress: true` (Wave 168, prevents two daily runs racing). If the outcome-verify sentinel fired a new `workflow_dispatch` before the previous attempt finished, the concurrency group would CANCEL the in-flight run rather than let it fail -- and the "Capture failure trace" step's `if: always() && failure()` condition does not fire on a cancelled run (GitHub Actions treats cancelled as a distinct conclusion from failure). That would explain 6 attempts, 0 traces, with no code bug required. Not confirmed (would need the actual run list/timing from the Actions tab, which needs `gh`/API access this sandbox doesn't have) -- flagging as the leading theory for whoever picks this up with UI access, before assuming the failure-handler itself is broken.

**Trigger:** next session with Chrome/API access to dispatch + watch the backfill run, or Christopher doing it himself (one click, see above).

---

## "Plate N." caption bug, RESOLVED Wave 314

**Found 2026-07-23** (Christopher spotted it live: "Why does it say 'Plate N' under the images?"). `generate-daily.js` told the model to write the caption as literally `"Plate N.,"` with N a placeholder for a step that never existed, so 76 of 106 published entries shipped the placeholder visible under the photo.

**The editorial call this note asked for turned out not to be one.** The worry was that some entries were backfilled out of date order, so a naive `index+1` would mismatch publish order. `scripts/lib/plate.js` derives the number from the entry's position in *date-ascending* order, which is the right answer regardless of the order entries were written in. `scripts/sync-plate-numbers.js` (Wave 314) reconciles every stored caption against it, and renumbers rather than only filling blanks, so inserting an entry mid-archive renumbers what follows instead of leaving two Plate LXI's. It also covers article figcaptions, whose plate number is the number of the entry whose photograph the figure shows -- read from the `<img src>` filename, not typed. It runs in the chain (`scripts/reconcile.js`, step 1) on every content build. Nothing to decide; closed.

## Duplicate-subject entries flagged by site-health.js (editorial call, Christopher's)

**Found 2026-07-23** via the weekly site-health audit's "Duplicate entries" check:

- `2026-06-02 Boeing 777X` vs `2026-05-01 Thiccc Boeing` — checked both full entries side by side. These ARE a real duplicate, not just same-category variety: both definitions are literally "aircraft aft fuselage looks thicc viewed from behind," same joke, same premise, just a different specific aircraft named. Recommend: not mine to merge/delete unilaterally since both are already-published URLs (referenced in past newsletters/social posts — deleting breaks those links). Options for Christopher: (a) leave both, add a "See also" cross-link so it reads as an intentional callback rather than an accidental repeat, (b) leave as-is, it's a big catalog and one repeat joke isn't a crisis, (c) redirect one to the other (breaks the older post's specificity). Leaning (a) if asked, but this is his call.
- `2026-05-11 Champion Watermelon, Heavyweight` vs `2026-05-05 Watermelon, Moon and Stars` — checked both. These are NOT actually duplicates: one is about a heavyweight-mass cultivar (contest/scale angle), the other about a distinctly-patterned cultivar (celestial spotting angle). Different real subjects, same parent fruit — same pattern as having separate African/Asian elephant entries. site-health.js's duplicate check is same-subject-family (both "watermelon"), which is too coarse here. No action needed on the entries; maybe worth tightening the site-health duplicate heuristic later so it doesn't flag legitimate same-category variety.


Things deferred from prior sessions that should be revisited at the right time. I (Claude) will surface these when the trigger condition matches.

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

Since Wave 321 the critic answers `isSubject` before it scores anything, and
`passesGate()` rejects a false outright. That matters for most of the rows
below: a desk globe, a teapot standing in for a kettle and a cannonball
standing in for a medicine ball are all photographs of the wrong object that
score well on composition, which is exactly what used to get through.

Wave 325 closes the sibling hole. `isSubject` asks whether the object is in the
frame; nothing was reliably asking whether it was *the photograph*. The critic
used to answer that with a volunteered `subjectPercentEstimate`, apply its own
"under 25% is a reject" rule to its own number, and hand both to a gate that
re-read the number and called it verification. It ran generous every time it
was checked. The critic now returns a bounding box and the area is computed in
code (`withMeasuredProminence()`), so the reject threshold is measured rather
than asserted. It also has to answer, in writing, what an uncaptioned viewer
would say the photo is of -- the line that reads "a modern kitchen" under an
entry titled Frigidaire. That answer is logged on both pass and reject, so a
future regression is visible in `audits/regen-last-run.md` without opening the
image.

The threshold stayed at 25 deliberately. Changing the measurement and the
threshold in the same wave would make it impossible to tell which one did the
work. Revisit the number after a few runs against real boxes.

**Wave 326 (2026-07-25).** The first run against the measured gate never
reached the gate. `stainless steel side by side refrigerator` returned zero
Unsplash photos, and an override used to short-circuit the query ladder to
exactly that one rung, so the run ended in `no-results` and the critic judged
nothing. The override now leads the ladder instead of replacing it: the
operator's phrase is tried first, the headword rungs stay behind it. Search
breadth and gate strictness had been tangled -- keeping the query narrow was
doing part of the gate's job back when the gate re-read a number the model had
volunteered. Wave 325 made the gate real, so a wider query can no longer ship a
worse photo, only hand the critic more candidates to reject. An override may
also carry its own rungs, pipe-separated (`timpani orchestra|timpani|orchestral
drum`), which is what the "else" entries in the table below were already saying
in prose. Covered by `scripts/test-search-queries.js`; `pre-ship-check.js` now
finds test suites by listing `scripts/` rather than naming each one.

**Wave 327 (2026-07-25).** The ladder worked, the reshoot ran, and the result
exposed that Wave 325 had not tightened the prominence gate so much as removed
it. `passesGate()` guarded its prominence check with `typeof
subjectPercentEstimate === 'number'`, which was a sensible tolerance while the
model was asked for that number directly and always sent one. Wave 325 stopped
asking for it and asked for a bounding box instead, so a response with a missing
or malformed box now arrives with no prominence number at all -- and the guard
waved it through while the run log said "passed". A gate that disappears exactly
when the critic answers badly is worse than no gate. It now fails closed, with
one carve-out: a response carrying no score either was never an answer, it is
the critic being unreachable, and `generate-daily.js` builds exactly that object
on a critique timeout. Failing that closed would block the daily post the way
Wave 209b's threshold blocked five days in a row.

Second finding, same run. The reject path logged score, measured percentage,
what the critic saw and what a stranger would call it; the pass path logged
score and what the critic saw. So the audit file carried full evidence for every
photograph that did not ship and partial evidence for every photograph that did.
Both paths now call one `formatCritique()`.

Both were found by looking at the photograph the pipeline said was a score-8
pass. It is a real-estate listing shot of a white kitchen with the refrigerator
standing about an eighth of the frame, and Unsplash's own caption calls it a
french door refrigerator, which is not a side-by-side.

The run after the fix landed the right photograph, and the audit row alone
would have been enough to trust it without opening the image: `score=8,
subject%=40, saw "a real side-by-side refrigerator in a kitchen", stranger sees
"a refrigerator in a kitchen"`. That is the whole point of Waves 325 through
327 -- the log line and the picture now say the same thing. Note also what is
absent: no `(claimed M)`, because the model is no longer asked for a number to
claim. The audit trail field only appears for a critic response that predates
Wave 325.

Open question the queue should now answer over the next few reshoots: whether
`minSubjectPct: 25` is still the right threshold. It was set against numbers a
model volunteered and it has never once been tested against a measured one.

Data so far, measured against my own eyeball on the rendered crop:

| Entry | Measured | Eyeballed | Delta |
| --- | --- | --- | --- |
| Frigidaire 2026-05-02 | 40 | ~32 | +8 |
| Globe 2026-05-26 | 35 | ~37 | -2 |
| Thick Water 2026-04-14 | 30 | ~20 | +10 |
| Kettle 2026-07-22 | 25 | ~9 | +16 |
| Medicine Ball 2026-07-06 | 40 | ~32 | +8 |
| Kettledrum 2026-05-14 | 40 | ~22 | +18 |
| Honeydew 2026-07-17 | 49 | ~35 | +14 |

Four points, worst error sixteen, three of four running high. The suspicion
logged after Thick Water is now confirmed by a second, larger case, and it is
no longer a hunch: **the box swallows whatever the subject is resting on or
held by.** The kettle occupies roughly a quarter of the width and a third of
the height, about nine percent of the frame. Twenty-five is almost exactly the
area of the kettle *plus the stove drum beneath it*, which runs to the bottom
edge. The Thick Water box took in the hand the same way.

That makes the Kettle the first entry to pass on measurement error rather than
on prominence: it cleared `minSubjectPct: 25` at exactly 25, and its true
prominence is well under the bar. Kept anyway, because it is a correct cast
iron kettle, in focus, unambiguously the visual subject of the frame, and it
ends a duplicate. But the number that admitted it was wrong.

Wave 328 fixes the prompt rather than the threshold. Criterion 8 said "box the
object, not the scene it sits in" and said nothing about what holds it up, so
the model was not being asked for the wrong thing, it was being asked for an
underspecified thing. It now names the exclusions -- stove, stand, table,
pedestal, cart, packaging, mount, hand -- and says explicitly that a support
named in the search wording ("kettle on a stove") is still not part of the
subject. That last clause matters because we write those queries ourselves:
Wave 327d/e established that naming a room invites the room, and this is the
same failure one step in. Naming the mount invites the mount.

The Medicine Ball row is the one that matters least as a delta and most as a
finding. Eight is a good measurement. The photograph is still bad, and it is
bad along an axis the number cannot see: the ball runs off the top and right
edges of the frame, and it measures 40 **because** it is cropped. A tight crop
inflates prominence. So the measured gate, left alone, quietly rewards exactly
the composition criterion 1 exists to forbid, and criterion 1 was being graded
only by the score -- which came back 7 against a gate of 7.

Wave 328e reads completeness out of the same bounding box: a subject whose box
reaches the frame edge on two or more sides has been cut off by the frame. This
is the Wave 325 move again, ask for the thing the model localises well and do
the arithmetic in JS, and it costs no extra field and no extra call. It is set
only on the regen gate. `daily` has no fallback, and `throwback` looks like it
can afford a rejection but cannot: post-to-buffer.js treats a throwback failure
as "skip the social post", so tightening it would suppress posts for every
already-published tight crop. That is Wave 209b with a different label, and it
is pinned by two tests so nobody adds it there later by symmetry.

Do not move the threshold on this. Every one of these passed, so the sample is
made entirely of photographs the gate liked, and nothing has yet been rejected
on prominence for the rejection to be judged wrong. A number tuned on its own
successes is the same mistake as a critic grading its own arithmetic. Tuning it
now would also be tuning against a measurement bias we have just fixed -- the
next few reshoots are the first honest read on the deltas.

**Wave 328f, and the honest read is bad.** The Kettledrum is the second
measurement taken under the tightened criterion 8 and it is the worst delta in
the table: measured 40, eyeballed about 22, an overshoot of eighteen. Working it
back from the rendered grid, the two timpani occupy roughly x 0.335 to 1.0 by y
0.475 to 0.80. For the model's box to reach 40% it has to run from about y 0.40
down to about y 0.98 -- that is the cymbal and mallets above the rims and, far
more of it, **the timpani stands below**. Criterion 8 names "stand" in its
exclusion list by hand. Naming the exclusion did not work.

That is worth saying plainly because Wave 328 was written as if it would. The
two worst deltas in the table are now Kettle +16 and Kettledrum +18, and both
are the same photograph in the abstract: an object sitting on or among the
hardware that holds it up. Five of six rows run high; the mean is about +10. So
the standing refusal to move `minSubjectPct: 25` holds for the reason it always
did, plus a new one -- moving it would be tuning against a bias that is still
present, still unfixed, and now demonstrably not fixable by adding words to the
prompt. The next attempt at this should probably ask the critic for the box of
the object and the box of whatever it rests on separately, so the arithmetic can
subtract rather than the prose can plead.

One correction to a hypothesis carried in from the reshoot itself. I flagged a
tension between the completeness gate passing and my own eye reading the
right-hand drum as cut off by the frame. There is no tension:
`maxEdgeTouches: 1` permits exactly one cut edge by design, and the right edge
is that one edge. The gate behaved as specified. The narrower true finding is
that **"touches one edge" cannot distinguish a subject resting against the frame
from a subject sliced by it.** Tightening to zero would reject the many good
compositions where a subject legitimately fills its frame, which is the Wave
209b failure again. Logged as a note, not an action.

**Wave 329's Honeydew is the row that breaks the explanation.** Measured 49,
eyeballed about 35 on the box, delta +14. What makes it worth more than another
tally mark is the photograph: one pale melon on a bare grey sweep. No stove, no
stand, no table, no hand, no packaging -- **nothing in the frame for the box to
swallow.** The "the box takes in whatever holds the subject up" theory, which
Kettle and Thick Water and Kettledrum all supported, cannot explain this one. So
that theory is at best partial and at worst a coincidence of three photographs
that all happened to contain furniture. Seven rows now: +8, -2, +10, +16, +8,
+18, +14. Six of seven high, mean about +10, and the errors do not sort by
whether there is anything to over-include.

The honest reading is duller and worse: **the critic simply estimates a generous
box, and prompt language has now failed twice to change that.** The next attempt
should stop asking better and start asking differently -- two boxes, the object
and its support, so code can subtract; or a coarse grid ("which of these 16
cells does the object occupy") which is a counting task rather than an
estimation task. Until one of those lands, `minSubjectPct: 25` stays where it
is, because a threshold calibrated against a measurement this biased is a
threshold calibrated against nothing.

**Two parked overrides were re-proposed on 2026-07-26 and are declined. Do not
fire either.** They are the pre-fix wordings that Waves 327d/e and 328 exist to
undo, and both entries are now resolved with correct photographs.

- `2026-05-14 Kettledrum` with `timpani orchestra`. "Orchestra" is the context
  word Wave 328f deliberately dropped from the lead rung, and dropping it is
  what landed the current correct plate. Re-adding it invites the orchestra in
  place of the drum, exactly as "kitchen" did on the Frigidaire. Worse, the gate
  does not protect against this failure: a context-dominant photograph is what
  passed at score 8 on the Frigidaire, which is the whole reason Wave 327
  existed. Firing this is a live regression risk on a plate that is right.
- `2026-07-22 Kettle` with `whistling stovetop kettle`. "Stovetop" names the
  stove, which criterion 8 lists by hand as an exclusion and which is the object
  that produced the +16 measurement overshoot on this very entry. The entry has
  no outstanding photograph complaint -- it is a correct cast iron kettle and it
  ended a duplicate with the teapot. The only open issue is measurement bias,
  which no reshoot can fix. Pure downside.

No substitute rung was fired for the Kettledrum either. Its one remaining
complaint is a crowded frame, and the only rungs that would address it are the
ones Wave 328f already used, so a re-fire draws from the same pool and returns
the same photograph. The Medicine Ball rule applies: at some point this stops
being a search problem.

| Date | Entry | Problem | Override to try |
| --- | --- | --- | --- |
| 2026-05-24 | Crankshaft, Marine Diesel | **RESOLVED Wave 321b.** Took three tries: a turbine rotor, then an engine block, both scored 7 on composition because nothing asked whether the photo was of a crankshaft. Wave 321's identity gate plus the bare head noun `crankshaft` landed a real Sulzer 1891 crank -- webs, journals, big-end bearings, score 8 | -- |
| 2026-05-02 | Frigidaire, Side-by-Side | **RESOLVED Wave 327b**, on the fourth firing. The photo is a genuine side-by-side -- two full-height vertical doors, dispenser in the left one -- standing centred and floor-to-ceiling in an otherwise empty hallway. Measured 40%; eyeballing the crop puts it near 32%, so the measurement tracks reality within single digits where the volunteered numbers were out by thirty-five. Stranger sees "a refrigerator in a kitchen", which is the first time that line has agreed with the headword. History: **FIRED Wave 323b, REGRESSED, RE-QUEUED.** The override worked in the sense that it returned photos, and the critic passed one at score 7. The photograph is captioned "modern kitchen with island and bar stools" and it is exactly that: island centre, four stools, a refrigerator down the left edge, partly outside the crop, about a ninth of the frame. This is the third instance of the same defect (blacksmith/anvil, desk globe, now this) and it is what Wave 325 fixes. **Re-fired Wave 325b: zero Unsplash results, so the measured gate was never exercised.** The five-word override was too specific for the library and, at the time, an override replaced the ladder rather than leading it. Wave 326 fixed that. **Re-fired Wave 326b: replaced, critic score 8.** The ladder found photos on rung one and the run completed, but the photograph is a real-estate listing shot of a white kitchen, refrigerator about an eighth of the frame, and Unsplash calls it a *french door* refrigerator, which is not a side-by-side. It passed because the prominence gate had a hole (Wave 327). Kept, because it beats the cut-off-at-the-edge photo it replaced. Re-fire against the closed gate, and lean on the configuration word so a french-door does not qualify | `side-by-side refrigerator two doors\|side by side refrigerator\|refrigerator` |
| 2026-04-14 | Thick Water | **RESOLVED Wave 327d.** Was ocean waves, audit 1/10. Now a hand holding a glass mug of opaque viscous liquid with a spoon standing in it, and the mug is printed `H2O`. Unsplash files it as milk; the mark on the glass is what makes it land. A hand in frame is allowed under criterion 5 -- the rule is no jokes about bodies, not no humans visible -- and the composition centres the glass. Measured 30 against an eyeball of about 20 on the glass alone, so the box probably took in the hand | `thickened water in a clear cup with spoon\|glass of thick liquid held in hand\|glass of water` |
| 2026-05-26 | Globe, Library Floor Model | **RESOLVED Wave 327c.** A genuine antique floor globe on a turned wooden stand, in focus and filling the left half of the frame, a second one behind it in the dark. Measured 35 against an eyeball of about 37. Second data point on the measured gate and the second time it has landed within single digits of the picture. History: **FIRED Wave 322b.** Entry says floor model; both photos to date are desk globes. This is the same identity failure the crankshaft had, so it is the right next test of the Wave 321 gate. Wave 322b fixed the identity; the framing stayed marginal, globe roughly a quarter of the frame with bookcases dominating. **Re-fired Wave 327c** as the first case whose recorded failure is prominence rather than identity, which makes it the cleanest read on whether the measured gate rejects on framing alone. Note "library" is dropped from every rung: naming the room is what invited the room, exactly as "kitchen" did on the Frigidaire | `antique floor standing globe on stand\|large world globe on wooden stand\|floor globe` |
| 2026-07-22 | Kettle, Cast Iron Tea | **RESOLVED Wave 328.** A dark cast iron kettle with a bail handle and a spout, sitting on a rusted outdoor stove drum against a stone wall. It is a kettle and not the teapot it used to duplicate, which was the whole bar. Measured 25 against an eyeball of about 9, the largest overshoot recorded and the case that produced the Wave 328 prompt fix -- the box took in the stove. Passed the gate on a number that was wrong; kept because the photograph is right | `cast iron whistling kettle on a stove\|cast iron kettle\|whistling kettle` |
| 2026-07-06 | Ball, Medicine Gym | Shares Unsplash TthLw9wNyQE with 2026-06-05 Cannonball, Naval. **FIRED Wave 328.** "Gym" is dropped from every rung under the Wave 327d/e rule, and no rung names a rack, stand or hand under the new Wave 328 clause: this is the first reshoot fired against the tightened criterion 8, so its delta is the first honest measurement in the table. Criterion 0 already names this exact confusion -- "a cannonball is not a medicine ball" -- so identity should hold; prominence is the thing to watch. **Result: critic-rejected, 29 candidates, 3 attempts, no replacement.** Last verdict score=1, "NOT THE SUBJECT", saw "a person balancing on a medicine ball". The library's answer to "medicine ball" is fitness-lifestyle stock with a human as the composition, which criterion 5 disqualifies. Nothing was shipped, which is the gate working: the old duplicate is still in place and no wrong plate went out. **Re-fired Wave 328b** on rungs that describe the object as an object and never as equipment in use. **Also critic-rejected**, and this one is the useful failure: the pool collapsed from 29 candidates to 6, and the last verdict was a firefighter helmet badge. "Vintage leather" found leather, not medicine balls. Crucially the run never tried the broad rung behind it, because the ladder stopped at the first rung returning anything and 6 is not zero -- which is the defect Wave 328c fixes. **Re-fired Wave 328c** against the accumulating ladder and a five-attempt window. **Rejected a third time, but the run itself proves the fix**: 34 candidates where the same lead rung gave 6, and 5 attempts where the cap gave 3. The last verdict also changed character -- "a modern exercise medicine ball on a wooden box", subject%=16 -- so the critic found the object and rejected the composition, where the first two firings could not find the object at all. That is a near-miss on vocabulary, not an empty library. **Re-fired Wave 328d** on the trade names a photographer actually files these under. Note the photo this entry currently carries is a stack of iron cannonballs at a fort wall: it is not merely a duplicate, it is the exact criterion-0 failure the critic prompt names by hand ("a cannonball is not a medicine ball"), and it belongs to 2026-06-05 Cannonball, Naval on the merits. **If 328d fails this stops being a search problem.** The recommendation then is editorial and belongs to Chris: either the entry keeps a knowingly wrong plate, or the headword changes to something stock photography has ("Slam Ball" / "Wall Ball" are photographed as objects; "Medicine Ball, Gym" is photographed as an activity). **328d replaced it, and the vocabulary hypothesis was right**: leading on "slam ball" found a real slam ball at score 7, subject 40%. The plate is kept because it is the right object and the cannonballs were the wrong one, and criterion 0 says in as many words that a beautiful photo of the wrong object is the worse outcome. It is still not a good plate: the ball is cut off at the top and right and a purple dumbbell sits in sharp focus across the foreground. That is what produced Wave 328e. **Re-fired Wave 328e** on the same ladder, which is not another vocabulary guess -- the vocabulary is solved -- but the first production test of the completeness gate, which should reject this exact photograph and dig further into the pool. **It did, and nothing better was behind it**: 30 candidates, 5 attempts, all rejected, last verdict a man playing basketball at 6%. So the cut-off slam ball stands, which is the fallback working as designed -- the gate declined to trade a right-object-badly-framed for a wrong-object-well-framed. **CLOSED with a caveat.** The duplicate with Cannonball, Naval is gone and the criterion-0 identity failure is gone; what remains is a composition complaint, which is a smaller defect than either, and five firings is enough. Anyone reopening this should change the headword rather than the query | `slam ball\|wall ball\|medicine ball` |
| 2026-05-14 | Kettledrum, Industrial | **RESOLVED Wave 328f**, with caveats worth reading. The plate now carries a genuine pair of copper timpani against a brick wall, score 8, and the stranger line agrees with the headword for only the second time on record. Dropping "orchestra" from the lead rung worked exactly as Wave 327d/e predicted -- it is a context word in the way "kitchen", "library" and "gym" were, and every one of those invited the context in instead of the object. Two caveats. The frame is crowded: music stands, microphone stands, a cymbal and a speaker cabinet share it, so this is a photograph of drums in a room rather than a plate of a drum. And the measurement is the worst in the calibration table, 40 against an eyeball of 22, because the box took in the timpani stands that criterion 8 names by hand as an exclusion. Kept because identity is right and identity outranks framing (criterion 0). Anyone reopening this wants a studio-isolated timpani, which the library may simply not have | `copper timpani drum\|timpani\|orchestral kettledrum` |
| 2026-07-17 | Honeydew, Giant | **RESOLVED Wave 329.** One pale honeydew, centred on a bare grey sweep, score 7, subject 49%, stranger sees "a honeydew melon". The rewording worked on the first firing. The original complaint -- "needs a scale reference or it reads as an ordinary melon" -- is not solved and is not solvable this way: there is no scale reference in the frame, so it does read as an ordinary melon, and every query that asks for one invites a person into the shot. Accepted as the better trade, because the entry's own definition supplies the scale joke in words and the plate only has to supply a melon. This entry is also the seventh calibration row and the one that broke the measurement theory (above), and the entry whose caption exposed Wave 329b. History: **Override reworded Wave 329 before firing.** The stored phrase was `honeydew melon held in hands`, which names a hand -- the exact word Wave 328's criterion 8 added to its exclusion list, and the exact composition that got three consecutive Medicine Ball firings rejected ("a person balancing on a medicine ball"). Asking for hands to solve the scale problem invites the fitness-lifestyle stock that has no object in it. A narrow lead rung is safe now that Wave 328c accumulates the ladder instead of stopping at the first rung that returns anything, so the melon leads and the bare head noun sits behind it | `giant honeydew melon\|whole honeydew melon\|honeydew melon` |

---

## Wave 329: the caption under the plate described the previous photograph

Found while eyeballing the Wave 328f Kettledrum. The entry now carries two
copper timpani; the caption under it read "Close-up of a drum head, showcasing
its substantial acoustic potential." That is a faithful description of the
photograph the regen had just deleted.

**The cause is an ownership gap, not a bug.** Both regen scripts documented the
boundary and neither closed it. `regenerate-text.js` says so in as many words --
"Wave 147 gave every image-side field to regenerate-images.js, so this script
writes text fields only" -- and discards the caption the model hands it.
`regenerate-images.js` writes image, photographer, photographerUrl and
unsplashUrl, and does not mention the caption anywhere in the file. So the field
was owned by neither, and the only thing that has ever written one is the
original `generate-daily` run. **A field owned by nobody is worse than a field
owned by the wrong script**, because a wrong owner at least shows up in a grep.
The general form: when a boundary comment says "X is not my job", grep whether
it is anyone's.

It is also the repo's recurring bug wearing a new label. The fact "what the
photograph shows" was stored twice, in the photograph and in the prose beneath
it, and only one copy got updated.

**The fix.** `scripts/lib/caption.js` writes a caption for the photograph that
is actually on disk, and `regenerate-images.js` calls it in the same block that
swaps the image. Three layers, each falling to the next, because this runs
unattended at the far end of a workflow and a caption is never worth failing a
replacement over: model in the house voice, then a flat deterministic line built
from the critic's own `photoSubject`, then null -- which the caller must read as
"keep what is there and say so in the audit file", never as "write an empty
caption". The whole block is wrapped and non-fatal; the image swap has already
succeeded by the time it runs. The banned-words filter now runs against this
field for the first time in the site's history, and it outranks voice: a caption
that breaks the editorial rules is worse than a dull one, and this is the only
path nobody reads before it ships. 18 checks in `scripts/test-caption.js`, all
against injected chat stubs so no key or network is needed.

**The backlog.** Wave 329 stops new drift; it cannot fix what is already on
disk, because knowing whether a sentence describes a picture requires looking at
the picture. `scripts/audit-caption-drift.js` does the part a script can do
exactly: it walks the history of `data/entries.json` and lists every entry whose
`image` changed more recently than its `caption`. That is a suspect list, not a
defect list -- a generic caption survives a reshoot of the same object fine.
Current read: **17 entries reshot, 10 suspects.** A ten-thumbnail contact sheet
adjudicated all of them in one look: **4 confirmed wrong and rewritten**
(Kettledrum, Crankshaft, Globe, Medicine Ball), **6 cleared** (Thick Water,
Frigidaire, Atlas Stone, Kettle, Mango, Meatloaf). The 6 stay on the list and
clear themselves automatically the next time they are reshot. A 60% false
positive rate is fine when the list is finite, ordered, and shrinks on its own;
a repeatable audit producing a suspect list beats a one-off finding.

### Wave 329b: the fix shipped a lie on its first outing

The Honeydew reshoot was fired in the same commit as Wave 329, so it doubled as
the first production test of the caption rewrite. The audit row carried the
`recaptioned` clause exactly as designed. The caption it carried was:

> Plate XCVIII., A sizeable honeydew melon posed with confidence on an elaborate
> silver serving platter, for grandeur.

There is no platter. There is no silver. The photograph is one melon on a bare
grey sweep, and the evidence the model was handed said "a whole honeydew melon"
and "round brown fruit placed on white surface". It furnished the room anyway.

**So Wave 329 traded a stale caption for an invented one.** Same defect class --
prose describing a photograph the reader cannot see -- with the cause moved one
step. Worth stating plainly rather than filing as a tweak, because the wave that
existed to stop captions lying about photographs shipped a caption lying about a
photograph, and it did so on attempt one.

The first instinct was to add "do not invent detail" to the system prompt. That
is the identical move to adding "stand" to criterion 8's exclusion list two
sections up, which had just been written up as *not working*. The repo's own
rule: ask the model for what it does well, and do the checking in code.

What it does well is voice. What it cannot be trusted with is the contents of a
frame it has never seen. So `ungroundedWords()` holds the model to re-saying, in
the house voice, only things already in evidence -- the headword, the critic's
`photoSubject`, Unsplash's description. Every other content word must come from
a fixed lexicon of voice and function words: posture, scale, rhetoric, grammar,
and deliberately no nouns about the world. "in majestic repose" survives.
"silver serving platter" does not. The refused attempt is pushed into a `notes`
array the caller puts in the audit row, so a human can see that a caption
shipped flat *because* the model tried to invent, which is a different event
from the model getting it right.

The check fails safe by construction, and that asymmetry is the design: a voice
word missing from the lexicon costs one dry caption, an ungrounded noun costs a
lie under a photograph. The lexicon is meant to reject more than it strictly
must. The prompt was tightened too, but as belt to the code's braces, not as the
fix. The deterministic fallback is exempt -- it is the critic's own sentence
with an article trimmed, so it is grounded by construction and filtering it
could only ever cost us the last caption we have.

The shipped Honeydew caption is corrected on disk. 28 checks in
`scripts/test-caption.js`, with the real bad caption pinned as the regression
anchor.

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

---

## Entry corrections don't propagate to already-queued Buffer posts

**ADDRESSED 2026-07-27 (Wave 330/330b):** `scripts/flag-stale-queued-posts.js` (report-only) now runs after regenerate-entry, regen-on-push, regenerate-text, AND regenerate-images. It scans queued/scheduled Buffer posts for the regenerated entries and writes `audits/stale-queue-flags/<stamp>.md`. It flags; it does not edit or delete. Remaining gap, deliberate: hand-edits to entries.json that skip the regen workflows get no flag. Proven need same morning: the 07-27 granite image regen shipped while last night's queued posts carried the old image, and all three published stale before the fix landed. Close fully once a flag report has fired in anger.

**Observed 2026-07-26:** the Hummer reel published Jul 25 with the pre-correction "H1" caption (entry was corrected to H2 on 07-23), and the mango reel published with the old sliced-mango image (entry photo was fixed to a whole mango on 07-24). Both posts were created before the corrections and sat in the queue across the fix.

**Fix shape:** when a correction lands (regenerate-images run, entry text edit), scan the Buffer queue for pending posts referencing that entry's date/slug and update or flag them. `scripts/buffer-queue.js` already knows how to list the queue; needs an update/delete-and-recreate path plus a hook in the correction workflows.

**Trigger to surface this:** next time an entry correction ships, or if the queue depth grows again (longer queue = longer exposure window; at ~1-5 posts/channel it's days).

---

## Remove the temporary 3:00 PM Buffer slots once the backlog drains

**Added 2026-07-26 (Wave 310):** all 3 channels got a second daily posting slot (3:00 PM Denver) so the ~15-post evergreen backlog drains at ~1/day/channel while the morning slot is now always taken by the day's fresh post (shareNext). Backlog at add time: X 5, IG 4, FB 6 (after the day's posts).

**Trigger:** any session where the Buffer sweep shows a channel's queue at 0-1 evergreen posts: remove that channel's 3:00 PM slot in Channel Settings -> Posting Schedule so cadence returns to 1x/day. Expected around 2026-08-01.
