# Queued Follow-ups

Things deferred from prior sessions that should be revisited at the right time. I (Claude) will surface these when the trigger condition matches.

## Submission upload pipeline — upgrade path

**Current state (as of 2026-05-09):** Submit-a-Thiccc page uses Option A — Cloudinary unsigned-upload widget feeds image URL into the existing Formspree form. Free, simple, works today.

**Why we picked it:** simplest, ~10 min total to ship, no backend work, $0.

**When to revisit:** If submission volume crosses ~5/week, OR if Christopher wants a centralized review dashboard, OR if Cloudinary free-tier limits become an issue (25GB storage / 25GB bandwidth/month).

**Upgrade options:**

### Option B — Cloudflare Pages Function + Resend email
- Submissions email Christopher with image attached
- Better than Cloudinary→Formspree two-hop because: integrated, no third-party form provider, plain email arrives in inbox
- Required: Resend free signup + 1 env var
- Estimated build: 25 min

### Option C — Pages Function + R2 + admin dashboard
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
- "fruit" + "produce" + "agriculture" + "heirloom" + "juicy" — botanical group
- "vehicle" + "truck" + "aircraft" + "aviation" + "heavy-duty" — transport group
- Tag "thiccc" on one entry is tautological (every entry is thiccc)
- Casing: "Italian" capitalized while others lowercase

**Recommendation:** consolidate to ~10-15 canonical tags. Each tag needs multiple entries to be useful.

**When to revisit:** an editorial decision Christopher should make. Surface this when catalog crosses 25 entries (currently 13) — tag sprawl gets worse with growth.

## iPostal1 setup — finish notary step

**Current state (2026-05-09):** Christopher started iPostal1 signup for the virtual mailbox. Got to the notary requirement (USPS Form 1583 needs notarization to authorize a third party to receive your mail). Paused there.

**Next steps when he comes back:**
1. Get USPS Form 1583 notarized — local options: bank (often free for customers), UPS Store ($5-15), online notary services like Notarize.com (~$25, instant)
2. Submit the notarized form to iPostal1
3. Wait ~1-2 days for activation
4. Address becomes live for use on USPTO trademark filing

**Trigger to surface this:** When Christopher next mentions trademark, mailbox, or asks "what's blocking trademark."

## Image-regen for Banana Cavendish

**Current state:** text was cleaned in Wave 43 but image is still generic-bananas-on-yellow stock shot.

**When to revisit:** any session — fully autonomous via sentinel mechanism. Just write a sentinel JSON for date 2026-05-03 with a tighter subject_override.

**Suggested override:** "single ripe banana close up macro food photography"

---

## Cloudflare Analytics install

**Current state:** Not installed. Site has zero baseline traffic data.

**When to revisit:** Christopher's first available 5-min window. The walkthrough is queued.

---

## Trademark filing-day session

**Current state:** Application drafted at legal/TRADEMARK-APPLICATION-DRAFT.md. Christopher chose DIY-with-Claude path with $250 USPTO fee. Filing window: next 30 days from 2026-05-09.

**When to revisit:** When Christopher has 30 min and a payment method ready. Computer-use will drive the form-fill.

**Pre-flight:** Christopher should set up a virtual mailbox or P.O. box first if he doesn't want his home address public on USPTO records.

---

## Brand-mention monitoring workflow

**Current state:** Not built. Google Alert set up by Christopher today as a manual backstop.

**When to revisit:** Anytime — fully autonomous build. ~30 min, uses Bing Search API or similar.

---

## Buttondown RSS-to-email — turn the subscribe form into a real newsletter

**Current state (2026-05-10):** Site has Buttondown subscribe form on every page + a valid `feed.xml`. Buttondown supports auto-emailing every new RSS item, but the toggle is OFF in Christopher's account. Site copy was softened from "every morning" to "in your inbox" in Wave 71 — the promise is now truthful but unfulfilled. New subscribers get nothing.

**The fix is a 60-second Christopher action:**

1. Go to https://buttondown.email/settings/integrations
2. Find the "RSS-to-email" section
3. Paste `https://thiccctionary.com/feed.xml` as the feed URL
4. Set frequency to "Send each new item as it appears" (or daily digest)
5. Save

**Why this matters:** every entry page asks for the email. ~13 hardcoded touchpoints, every social CTA, the press kit — they all funnel to a list that doesn't currently mail anything. Conversion rate doesn't matter when the product behind the form is broken.

**When to revisit:** Christopher's next 1-min Buttondown session. Surface this whenever he opens Buttondown for any reason.

---

## Daily cron silent-skip diagnosis — SOLVED 2026-05-10

**Resolution:** Christopher pulled the workflow run logs and the failure was concrete: `Beluga, Airbus` was sitting at the front of `data/subject-queue.json` with an Unsplash query that returned zero results. The script threw uncaught and failed red every morning. Wave 73 added the `query`-field honoring + zero-result fallback. The watchdog (Wave 72) is still useful as a backstop for unrelated future failures — picker veto and critique gate exit-0 paths still exist and will trigger it.

**For future failures:** if the watchdog fires, the recovery path is:
1. Open https://github.com/christopherlhicks29-create/thiccctionary/actions/workflows/daily.yml
2. Click into the most recent failed run
3. Screenshot the "Generate today's entry" step output
4. Paste it into chat — most failures will be diagnosable from a single error line.

**Re-queueing the Beluga:** still a viable subject if we get a working Unsplash query. Alternates to test: `airbus beluga xl`, `airbus a300-600st`, `cargo aircraft beluga`. If none return results, Beluga is too rare for Unsplash and should move to the print-exclusive pile or a custom-photo wave.
