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
