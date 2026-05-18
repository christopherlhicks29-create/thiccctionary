# Queued Follow-ups

Things deferred from prior sessions that should be revisited at the right time. I (Claude) will surface these when the trigger condition matches.

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


## Image-regen for Banana Cavendish

**Current state:** text was cleaned in Wave 43 but image is still generic-bananas-on-yellow stock shot.

**When to revisit:** any session, fully autonomous via sentinel mechanism. Just write a sentinel JSON for date 2026-05-03 with a tighter subject_override.

**Suggested override:** "single ripe banana close up macro food photography"

---

## Cloudflare Analytics install

**Current state:** Not installed. Site has zero baseline traffic data.

**When to revisit:** Christopher's first available 5-min window. The walkthrough is queued.

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
