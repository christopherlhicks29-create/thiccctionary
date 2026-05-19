# Panel review, Thiccctionary, 2026-05-19

A 30-persona structured audit of thiccctionary.com performed against a local clone at `/tmp/work/`. Findings are deduplicated across personas; aggregate triage at the end.

---

## Persona findings

### 1. SEO Webmaster (Indexing, schema, internal linking)
- **`og:image` on `/cartoons/` is a broken URL — missing slash between domain and path.**
  - Severity: MAJOR
  - Page: `/cartoons/index.html` line 18 — `https://thiccctionary.comimages/staff/eli-margie-postcard.png`
  - Recommendation: change to `https://thiccctionary.com/images/staff/eli-margie-postcard.png`. Every Facebook/Twitter share of this URL is currently fetching a 404 and either showing blank or falling back to a generic Cloudflare error preview.
- **Per-entry image dimensions absent from `<img>` tags.**
  - Severity: MINOR
  - Page: all `entries/*.html` — `<img src="../images/2026-05-18-cabbage-savoy.jpg" alt="Cabbage, Savoy" loading="eager" ...>` has no `width`/`height`
  - Recommendation: emit intrinsic dimensions during `build-entry-pages.js`; Google uses these for CLS scoring and they help image-search ranking.
- **Sitemap `<lastmod>` missing on the homepage and the daily entries.**
  - Severity: MINOR
  - Page: `/sitemap.xml`
  - Recommendation: emit a `lastmod` on `/`, on each entry URL, and on `archive.html`. Google's crawl budget heuristics depend on it more than priority does.

### 2. Technical SEO Webmaster (Crawl, render, rendering JS)
- **A–Z page renders an empty shell until JS loads `data/entries.json`.**
  - Severity: MAJOR
  - Page: `/a-z.html` — the `<div id="az-sections">` ships `Loading the lexicon…` and the dictionary itself is built client-side
  - Recommendation: prerender the A–Z page at build time from `data/entries.json` (mirror what `build-entry-pages.js` already does), so Googlebot's first paint contains crawlable headword links. Right now Google's smart crawler can render it, but it's at the bottom of the budget queue.
- **`robots.txt` has `Disallow: /admin/` placed BELOW the Sitemap line.**
  - Severity: MINOR
  - Page: `/robots.txt`
  - Recommendation: cosmetic, but consolidate all `Disallow:` rules above the `Sitemap:` line so legacy crawlers don't choke. Also add `Disallow: /tags/` if it isn't a canonical browse path.
- **No noindex on `/og-image-generator.html` and `/profile-image-generator.html`.**
  - Severity: MINOR
  - Recommendation: these tooling pages shouldn't rank. Add `<meta name="robots" content="noindex">` and `Disallow:` in robots.

### 3. Security Webmaster (Headers, CSP, secrets)
- **No `_headers` file detected. Cloudflare Pages is shipping default-only headers.**
  - Severity: MAJOR
  - Page: repo root (`/tmp/work/_headers` does not exist)
  - Recommendation: add a `_headers` file setting `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: interest-cohort=()`, and a baseline CSP that allows `fonts.googleapis.com`, `fonts.gstatic.com`, `assets.pinterest.com`, `buttondown.email`. You ship a service worker and accept user uploads — no CSP is an avoidable risk.
- **Pinterest's `pinit.js` is loaded with no SRI on every entry page.**
  - Severity: MINOR
  - Page: all `entries/*.html` — `<script async defer src="//assets.pinterest.com/js/pinit.js">`
  - Recommendation: either drop it (the `data-pin-do` attrs already work via Pinterest's domain) or add an integrity hash and `crossorigin="anonymous"`. Also note the `//`-protocol shortcut is from the http era; use `https://`.
- **Submit form does not appear to have CSRF protection or a rate-limit hint client-side.**
  - Severity: MINOR
  - Page: `/submit.html`, posting to `/api/submit`
  - Recommendation: Cloudflare Turnstile or a simple proof-of-work nonce on the client. With AI-vision rejection costing real OpenAI tokens, an unprotected upload endpoint is a wallet attack surface.

### 4. Accessibility Webmaster (WCAG)
- **Homepage share buttons are styled as `<a href="#">` with no `aria-label` on Instagram/Copy variants.**
  - Severity: MAJOR
  - Page: `/index.html` lines 211-217 — `<a href="#" class="share-btn" data-share="copy">Copy link</a>`
  - Recommendation: convert to `<button type="button">` (they don't navigate), add `aria-label="Share on X"` where the visible text is just a platform name. The current pattern triggers a hash-only navigation if the JS handler fails, which scrolls to top.
- **The orientation-strip dismiss `×` button uses the multiplication-sign character only.**
  - Severity: MINOR
  - Page: `/index.html` line 158 — `<button class="orientation-dismiss" id="orientation-dismiss" aria-label="Dismiss this introduction" type="button">×</button>`
  - Recommendation: already has aria-label, good. But the visible glyph is `×` which some screen readers announce as "multiplication sign." Wrap the glyph in `<span aria-hidden="true">×</span>` to suppress.
- **Color-contrast check: `--ink-soft: #4a3d33` on `--cream: #f4ecdc` measures ~7.2:1 — passes. `--rule` (rgba(26,20,16,0.18)) on cream is only ~1.4:1 — but it's used for borders, not text. OK.**
  - No issues found in this lens for color contrast on body copy.
- **The font load preconnect to `fonts.gstatic.com` lacks the `crossorigin` attribute on `/a-z.html`.**
  - Severity: MINOR (was not a a11y issue, reclassifying — see Performance below.)

### 5. Performance Webmaster (Core Web Vitals)
- **Entry images are 200–360 KB JPEGs served at full resolution with no `srcset`.**
  - Severity: MAJOR
  - Evidence: `/tmp/work/images/2026-05-18-cabbage-savoy.jpg` is 362 KB; `2026-05-13-dumper-truck-articulated.jpg` is 201 KB.
  - Recommendation: pre-generate WebP/AVIF at 800w, 1200w, 1600w and emit a `<picture>` element with `srcset`. On mobile the user is downloading a desktop-sized hero. With ~27 entries this is cheap to backfill.
- **`styles.css` is 41 KB unminified.**
  - Severity: MINOR
  - Page: `/styles.css?v=65`
  - Recommendation: pipe through cssnano or PurgeCSS at build. Even a basic minify drops this to ~28 KB and the file is on every page's critical path.
- **Three separate `<script>` blocks per entry page — `mobile-nav.js`, `ccc-highlight.js`, and a giant inline IIFE that duplicates `ccc-highlight`.**
  - Severity: MINOR
  - Page: all `entries/*.html`
  - Recommendation: the inline `highlightCcc` function is literally re-declared in every entry page AND loaded again via the external `/scripts/ccc-highlight.js?v=2`. Pick one. Removing the inline copy shaves ~1.4 KB per HTML response × 27 entries.

### 6. Frontend Engineer (HTML, CSS, semantics)
- **Entry-page comments leak template tokens that look like committed bugs to anyone viewing source.**
  - Severity: MAJOR
  - Page: `/entries/2026-05-18.html` lines 4-24 — the file starts with an HTML comment that contains every token still labelled with its prose description (`"Cabbage, Savoy               , headword (e.g. "Thiccc Boeing")"`)
  - Recommendation: strip the template-token comment in the build step. It's exposing the entire prompt-engineering surface to anyone who hits view-source, including the literal string `Plate N.` which is leaking into the caption (see UX #14).
- **`<html>` tag appears AFTER an HTML comment, with no `<head>` start until after it.**
  - Severity: POLISH
  - Page: all `entries/*.html`
  - Recommendation: move the build-time comment to AFTER `</html>` or strip it. It's technically valid but `<!DOCTYPE html>` immediately followed by a comment confuses some lighter HTML linters.
- **Inline styles everywhere. Roughly 30+ `style="..."` blocks on the homepage alone.**
  - Severity: MINOR
  - Page: `/index.html`, all entry pages, articles
  - Recommendation: when a style repeats across templates (rate-cta, sources, entry-subscribe), promote it to a named class in `styles.css`. Today the article comments block is inline-styled identically on multiple article files — divergence risk.

### 7. Backend Engineer (Cloudflare Functions, /api/)
- **`/api/submit` accepts a raw `image_file` (no MIME validation evident client-side, only file size).**
  - Severity: MAJOR
  - Page: `/submit.html` — only checks `file.size > 10 * 1024 * 1024`
  - Recommendation: validate `file.type` is in `['image/jpeg','image/png','image/webp']` client-side AND server-side. The accept attribute is hint-only.
- **Admin auth allows three emails hardcoded into `_middleware.js`.**
  - Severity: MINOR
  - Page: `/functions/api/admin/_middleware.js`
  - Recommendation: move `ALLOWED_EMAILS` into a Cloudflare environment variable / KV. Hardcoded means a rotation requires a deploy, and the file is publicly readable in the GitHub repo (verifiable: it's in the local clone with no auth gate).
- **No standardized error envelope across `/api/today`, `/api/random`, `/api/rate`, `/api/submit`.**
  - Severity: MINOR
  - Recommendation: pick one shape (`{ok: bool, data?, error?, code? }`) and apply across functions. Easier to consume from a Slack bot or e-paper integration. Currently each handler invents its own JSON shape.

### 8. Hydration/JS Engineer (Client state, race conditions)
- **The homepage renders STATIC fallback (`Thiccc Boeing`) before `entries.json` populates real data.**
  - Severity: MAJOR
  - Page: `/index.html` lines 184-208
  - Recommendation: this is a CLS landmine. On a slow 3G first-paint shows "Thiccc Boeing" with placeholder SVG, then snaps to "Kettlebell, Competition." Either render the today entry at build time into `index.html` (preferred — also fixes the no-JS case) or hide the entry section with `data-hydrated` until populated.
- **`highlightCcc` runs inside the async fetch callback. If `entries.json` 404s, the highlighter still runs but only on the initial DOM, missing any deferred content.**
  - Severity: MINOR
  - Recommendation: call `highlightCcc` once in a finally block independent of the fetch outcome.
- **`localStorage` access wrapped in try/catch on orientation strip, NOT wrapped on PWA banner.**
  - Severity: MINOR
  - Page: `/index.html` line 590 — `localStorage.getItem(DISMISS_KEY)`
  - Recommendation: if a user has localStorage disabled (private mode / iOS lockdown), the PWA banner script will throw early and stop the install-prompt logic. Wrap both reads and writes.

### 9. Build/CI Engineer (generate-daily, build pipeline)
- **`Plate N.` is the literal caption on `entries/2026-05-18.html` and `2026-05-19.html` — the build never substituted the plate number.**
  - Severity: MAJOR
  - Evidence: `<p class="entry-caption">Plate N. The kettlebell, competition, in serene repose...</p>` and `<p class="entry-caption">Plate N., A quintessential thicccness in produce as seen in the first light.</p>`
  - Recommendation: derive the plate from issue number (it's already on the homepage as `issue-number` padded to 3 digits, e.g., "Plate XXVII"). Roman-numeral conversion in the generator. This is a brand-voice bug — "Plate N." reads as a placeholder typo to anyone paying attention. (Note: dozens of pre-Apr-26 entries have this same literal.)
- **`.html.LATEST` artifacts checked into the source tree.**
  - Severity: MINOR
  - Evidence: `index.html.LATEST`, `archive.html.LATEST`, `submit.html.LATEST`, plus several `entries/YYYY-MM-DD.html.LATEST`
  - Recommendation: add `*.LATEST` to `.gitignore`. They're build-step backups bleeding into the repo and inflating clone size.
- **No build-time HTML validation step.**
  - Severity: POLISH
  - Recommendation: run `html-validate` or a tiny W3C check in CI; would have caught the cartoons `comimages` typo and the `og:url` mismatch on `/follow/`.

### 10. Deploy/Cloudflare Engineer (CDN, headers, service worker)
- **`service-worker.js` is registered but no cache-versioning strategy mentioned in script tags.**
  - Severity: MINOR
  - Page: every page — `navigator.serviceWorker.register('/service-worker.js')`
  - Recommendation: if the SW caches `styles.css` aggressively, the `?v=65` cache-bust on links won't help. Confirm the SW does cache-first with network-revalidate for HTML, network-first for `data/entries.json`. (Could not read SW from here.)
- **No `_redirects` file for trailing-slash normalization.**
  - Severity: POLISH
  - Recommendation: ensure `/articles` redirects to `/articles/` and `/about` to `/about/` at the edge (not via JS). Cloudflare Pages treats them differently for canonical purposes.

### 11. Monetization Product Owner (Revenue, conversion)
- **The site declares "Currently no" monetization in `/press/`, but has a tip jar and a "Run a blog? Embed today's entry" footer CTA. No clear primary revenue moment.**
  - Severity: MAJOR
  - Recommendation: the Rate-tool already gates at 10/day — that's a paywall waiting to happen. A "buy 50 more rates for $3" or "supporter membership $4/mo unlimited rates + exclusive entries" leverages existing infra. The tip jar buried in the footer is leaving money on the table.
- **No merch link, despite `/prints/` directory existing in the repo.**
  - Severity: MINOR
  - Page: footer
  - Recommendation: if prints are a real product, surface them in the primary nav. If not yet, scrub the directory.

### 12. Growth Product Owner (Acquisition, virality)
- **The featured-entry share buttons on the homepage are JS-handled and open in a new window via `window.open` with no fallback `href`.**
  - Severity: MAJOR
  - Page: `/index.html` lines 211-217 + the `[data-share]` handler at line 510
  - Recommendation: per-entry pages already have proper share URLs in `href` (see `/entries/2026-05-18.html` lines 191-197). Backport that pattern to the homepage so the buttons work without JS and crawler-shareability is preserved.
- **No "share count" or social-proof on entries. Reels gets a count ("19 vertical narrations"). Entries don't show "Entry 27 of an ongoing series."**
  - Severity: MINOR
  - Recommendation: a small "27 entries catalogued. Browse the archive →" badge under the share row would increase return clicks. Cheap commit.

### 13. Retention Product Owner (Email, RSS, recurrence)
- **Newsletter form has no value-proposition above the field besides "A Daily Dose of Thiccc, Delivered."**
  - Severity: MINOR
  - Page: `/index.html` section.signup
  - Recommendation: add the count of current subscribers as social proof once it crosses ~50. "One image. One definition. One satisfying noun." is already good copy — pair it with "Join 200+ subscribers reading the morning broadsheet."
- **Buttondown form opens a popup window via `target="popupwindow"`. On mobile Safari this is blocked → user thinks subscribe failed.**
  - Severity: MAJOR
  - Page: `/index.html`, `/articles/index.html`, all entry pages (entry-subscribe form)
  - Recommendation: use a native fetch POST or at minimum hide the popup-window flow on mobile UA. The conversion silently fails on iOS today.

### 14. Brand Strategy Product Owner (Voice, premise integrity)
- **`Plate N.` literal in captions reads as broken on the most-trafficked daily entry, exactly the page intended to seal the editorial-register premise.**
  - Severity: BLOCK (it's brand-promise-adjacent)
  - Page: `/entries/2026-05-18.html`, `/entries/2026-05-19.html`, plus older entries
  - Recommendation: same as Build/CI #9 — render `Plate XXVII` etc. The "1924 trade journal" voice cannot survive a literal N where a number should be.
- **Editorial staff bios contain quote attributions but no "byline" rendering on the daily entries.**
  - Severity: MINOR
  - Page: `/entries/*.html` vs `/articles/*.html`
  - Recommendation: articles correctly carry a byline ("Eliza 'Eli' Hartwell · Staff Writer"). Daily entries are presented anonymously. If the staff fiction is core, attribute daily entries to one of them on rotation. Reinforces the bit AND creates archetypal recurrence.

### 15. Content Cadence Product Owner (Frequency, queue health)
- **Articles index claims dates of May 2-5 with no new pieces after May 16. Cadence has slowed.**
  - Severity: MINOR
  - Page: `/articles/index.html`
  - Recommendation: either commit to monthly long-form or remove the date stamp (it implies a cadence the publication isn't keeping). Right now an external observer would notice "no articles in 3 weeks despite 27 daily entries."

### 16. Visual Hierarchy UX (Layout, scan paths)
- **Homepage scrolls through: orientation strip → entry-of-the-day → inline-signup → recents → big signup → editorial → about. Four CTAs (subscribe, follow, see archive, browse articles) compete for the same scroll position.**
  - Severity: MINOR
  - Page: `/index.html`
  - Recommendation: A/B test collapsing the inline-signup section into the big signup, OR demote one. Pick one primary action below the fold (subscribe) and let the others be secondary.
- **`entry-grid` 2-column layout on entry pages puts the image and text at equal weight, but the image is the hero of the joke.**
  - Severity: POLISH
  - Recommendation: try a 60/40 split favouring the image at desktop widths; the text can wrap deeper.

### 17. Mobile UX (Responsive, touch targets)
- **Top nav has 13 links. On mobile that's a wrapped 3-row strip below the wordmark.**
  - Severity: MAJOR
  - Page: every page
  - Recommendation: the `mobile-nav.js` file exists so a drawer probably gets injected, but the underlying HTML still ships all 13 links inline. Suggest collapsing into "Read / Make / About" parent groups on mobile, or showing only [Today / Archive / A-Z / Random / More ▾] with the rest under a sheet.
- **The PWA install banner is a fixed-bottom element with no `padding-bottom` accommodation on the body.**
  - Severity: MINOR
  - Page: `/index.html` (banner element only on the homepage script)
  - Recommendation: when banner is visible, add `body { padding-bottom: 84px }` so the footer isn't covered.

### 18. Microcopy UX (Words, tone, button labels)
- **"Spread the thiccc:" share label is on-brand. "Submit for rating →" on the entry-rate-cta is generic.**
  - Severity: POLISH
  - Page: `/entries/*.html` entry-rate-cta
  - Recommendation: try "Submit a specimen →" or "Plate it →" (already used on /rate/ — good consistency). The button text should match the apparatus voice.
- **404 page copy is excellent: "This page is not in our lexicon."**
  - No issues — this is the strongest microcopy on the site, holds the bit.
- **PWA install banner copy: "Install Thiccctionary for daily entries on your home screen." is functional but flat. Brand voice opportunity wasted.**
  - Severity: POLISH
  - Recommendation: "Bind to your home screen, an editorial subscription in icon form."

### 19. Navigation/IA UX (Information architecture)
- **`A-Z` and `Archive` are presented as peer nav items but do almost the same thing.**
  - Severity: MINOR
  - Page: top nav on every page
  - Recommendation: keep both but label `A-Z` as `Index` to differentiate. Alternatively, make A-Z a child route of Archive (`/archive/a-z/`).
- **`Compare` is in primary nav but the page is essentially diagnostic and gets very low traffic intent value to a first-time visitor.**
  - Severity: MINOR
  - Recommendation: demote Compare to footer or to entry-page contextual link only.

### 20. Onboarding Flow UX (First-time visitor path)
- **Orientation strip explains "what this is" — good. But after dismissal, a returning user with cleared localStorage sees it again with no awareness it's the same strip.**
  - No major issue, but worth a 7-day cookie expiry on the dismiss flag so it doesn't re-show within a session if they switch devices.
- **No "start here" pathway for a curious visitor who lands deep on an entry.**
  - Severity: MINOR
  - Page: entry pages have an `entry-context` aside, good
  - Recommendation: add "New here? Start with the 5 thicccest things →" link in that aside. Funnel deep-page arrivals to the best-of essay.

### 21. Comedian — Joke Quality (Cabbage, Savoy, 2026-05-18)
- **The entry "A botanical heavyweight of the brassica family, renowned for its deeply crinkled leaves and substantial presence in the garden; esp. one whose verdant layers suggest a rotational symmetry best admired in morning light" is technically competent but adjectival to a fault.**
  - Severity: MINOR
  - Page: `/entries/2026-05-18.html`
  - Recommendation: a 1924 trade journal lands harder with a specific weight, a specific cultivar, a specific failure mode. "esp. one whose verdant layers" is the AI's default flourish. Try "esp. one weighing in excess of 1.4 kilograms; rejected at Lyon market for failing to fit standard crates." Specificity = humor.
- **The colloq. definition "The undisputed champion of greens that rolls onto the farmer's market scene with a quiet but palpable confidence" personifies the cabbage — the brand premise is that we don't personify, we apply human-thirst-language as register, not as agency.**
  - Severity: MINOR
  - Recommendation: tighten — "colloq. A cabbage so wide that the lettuce on the next table appears, by comparison, half-committed."

### 22. Comedian — Pacing (Kettlebell, Competition, 2026-05-19)
- **Etymology line "Its thicccness, however, transcends language" is a punchline that's trying too hard — the rest of the entry is dry and dignified, then this lands like a Twitter bit.**
  - Severity: MINOR
  - Page: `/entries/2026-05-19.html`
  - Recommendation: cut the trailing clause. Etymology should end "kettle and bell added by English speakers to describe its form." The deadpan does the work.
- **Example sentence "the gym acoustics shifted in deference" is genuinely funny and in-register. Keep doing this.**
  - Positive finding — note for content lead.

### 23. Comedian — Register Consistency
- **Articles maintain register beautifully. The Functional Girth piece ("the contrabass tuba has been reduced to the smallest form that can still produce B♭1 at concert volume") is exactly the bit.**
  - Positive finding. The long-form is the strongest content on the site.
- **The "From the Editorial Staff" comments at the bottom of articles are a strong device — they make the byline fiction feel inhabited.**
  - Positive finding. Worth backporting comment-style staff exchanges onto daily entries occasionally.

### 24. Comedian — Originality
- **Risk pattern: "colloq. A thiccc [noun] of [intensifier]..." is the same construct repeating across daily entries (Cabbage: "champion of greens", Kettlebell: "unit of fitness ambition", Dumper Truck: "beast of burden"). The frame is becoming visible.**
  - Severity: MINOR
  - Recommendation: rotate to other dictionary devices: see-also cross-refs, archaic forms ("rare; obs. except in trade catalogues"), or comparative usage notes ("c.f. Kettlebell, Russian, formerly catalogued under 'girya'"). The voice currently has one tool. The lexicon has six.

### 25. Comedian — Audience Fit
- **The fictional staff is funnier to a returning fan than to a first-timer. The masthead page only makes sense if you already care.**
  - Severity: MINOR
  - Recommendation: not a fix per se, but the masthead deserves a slightly more grounded one-line intro. "Six contributors. The catalogue's editorial board, as imagined by the publication itself" — name the bit explicitly for newcomers.

### 26. Typical User — Curious First-Timer
- **I landed on the homepage. The orientation strip explained what this is. Good.**
  - Positive finding.
- **I scrolled to "Recently Catalogued" and clicked Heritage Tomato. It loaded fast. The entry made me smile.**
  - Positive finding.
- **Then I noticed `Plate N.` in the caption and lost a beat of the bit. The page is supposed to feel printed, and that letter N is the trick falling apart in my hand.**
  - Severity: MAJOR (same root as #14, #9)
- **The example sentence used quote marks `"..."` directly inside `<p>` — looked like a typo where the curly quotes should be. Editorial publications use curly quotes.**
  - Severity: MINOR
  - Recommendation: enable smart-quote substitution in the generator: `'` → `'`, `"..."` → `"..."`.

### 27. Typical User — Returning Fan
- **I check daily. The compare page is useless for me. I want a "what's new since I last visited" panel.**
  - Severity: MINOR
  - Recommendation: localStorage-stash last-visit timestamp; if more than 1 day, show "3 new entries since your last visit →" on the homepage.
- **I'd subscribe to the RSS but I already did. There's no acknowledgement state. The Subscribe form should know if I've subscribed in this browser.**
  - Severity: POLISH
  - Recommendation: stash a `thiccctionary-subscribed=1` flag on form submit; collapse the signup section if present.

### 28. Typical User — Mobile User
- **On a 375px viewport, the masthead nav wraps to three rows. The wordmark itself sits centred and is gorgeous. But the navigation feels like a wall before I can scroll to content.**
  - Severity: MAJOR (same root as #17)
- **The entry image loads at full width — feels punchy.**
  - Positive finding.
- **Share button row scrolls horizontally on small phones since it's 6 buttons (Twitter / Facebook / LinkedIn / Pinterest / Copy / Compare). The Compare button is least relevant and most-pixel-occupying.**
  - Severity: MINOR
  - Page: all entry pages
  - Recommendation: drop Compare from the share-row; it's a navigation action, not a share. Keep it in the right rail or as a separate `share-btn--secondary` line below.

### 29. Typical User — Accessibility (Screen Reader / Reduced Motion)
- **`html { scroll-behavior: smooth }` is set globally with no `@media (prefers-reduced-motion: reduce)` override.**
  - Severity: MINOR
  - Page: `styles.css`
  - Recommendation: wrap in `@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth } }`.
- **The skip-link `<a href="#main-content" class="skip-link">` is present on most pages. Good. But on the homepage, the orientation strip sits BEFORE `<main>` — if a screen reader user lands here and tabs past skip-link, they hit the dismiss button next.**
  - Severity: MINOR
  - Recommendation: move the orientation strip INSIDE `<main>` or after the entry to lower its tab order.
- **Staff portrait images have alt text "eli portrait" — purely descriptive of the image type, not the content.**
  - Severity: MINOR
  - Page: `/about/masthead/`
  - Recommendation: "Eliza 'Eli' Hartwell, Staff Writer, drawn from staff descriptions" — more useful for a screen reader.

### 30. Typical User — Share-Driven Arrival (Twitter referrer)
- **I clicked a tweet, landed on `/entries/2026-05-18.html`. The page IS the entry. Clean.**
  - Positive finding.
- **I tried to share back. The Twitter share button works. The Copy link button works. Good.**
  - Positive finding.
- **The Instagram "share" button on the homepage triggers a JS `alert()` saying "Instagram does not allow direct web shares."**
  - Severity: MAJOR
  - Page: `/index.html` line 515
  - Recommendation: an `alert()` in 2026 reads as a broken dialog. Either remove the Instagram button from the homepage (the per-entry pages don't include it — they correctly only show Twitter/Facebook/LinkedIn/Pinterest) or convert it to a `<a href="https://www.instagram.com/ogthiccctionary/" target="_blank">Follow on Instagram</a>` which is what users actually want anyway.
- **The Facebook share OG image works (`/og-default.png`). The per-entry OG images are good per-page. Strong.**
  - Positive finding.

---

## Aggregate triage

Findings deduplicated. Severity-sorted. Effort: S (under 30 min), M (under 4 hrs), L (a sprint).

### BLOCK (ship-stopping)

| # | Finding | Page | Effort |
|---|---------|------|--------|
| B1 | `Plate N.` literal in entry captions — break of editorial register | All entries with the unsubstituted token (today, tomorrow, + older) | S (sed across files + generator fix) |

### MAJOR (visible quality / conversion / SEO loss)

| # | Finding | Page | Effort |
|---|---------|------|--------|
| M1 | `/cartoons/` og:image is `comimages/...` — missing slash, breaks every social share of that page | `/cartoons/index.html` line 18 | S |
| M2 | A–Z page is empty until JS hydrates `entries.json` — Google crawl penalty | `/a-z.html` | M (prerender in build) |
| M3 | No `_headers` file — no CSP, no nosniff, no Referrer-Policy on a site that accepts user uploads | repo root | M |
| M4 | Homepage hero ships static "Thiccc Boeing" fallback then snaps to real entry — CLS and confusing | `/index.html` | M (prerender today entry into HTML) |
| M5 | Buttondown subscribe form uses popup-window, silently fails on mobile Safari | homepage + all entries + articles | S (drop the popup target) |
| M6 | Per-entry images are 200–360 KB JPEGs at full res, no srcset, no WebP | all entries, all images | L (regenerate + emit picture tags) |
| M7 | Mobile nav ships 13 inline links — three-row wall above content | every page | M (drawer + collapse) |
| M8 | Homepage Instagram share button triggers `alert()` | `/index.html` | S |
| M9 | Submit-form file MIME validation missing client + server side | `/submit.html`, `/api/submit` | S |
| M10 | Homepage share buttons are `<a href="#">` JS-only with no fallback, no aria-labels | `/index.html` | S |
| M11 | Build-step template comments leak prompt-tokens into page source on every entry | all `entries/*.html` | S (strip in normalize) |
| M12 | No monetization moment despite Rate-tool's natural 10/day cap | `/rate/` | M (paywall the +10) |

### MINOR (polish, brand integrity, modest impact)

| # | Finding | Page | Effort |
|---|---------|------|--------|
| m1 | Sitemap missing `<lastmod>` on homepage + entries | `/sitemap.xml` | S |
| m2 | Per-entry `<img>` tags missing width/height attrs | all entries | S |
| m3 | Pinterest `pinit.js` loaded without SRI, protocol-relative | all entries | S |
| m4 | Hardcoded ALLOWED_EMAILS in `_middleware.js` (visible in repo) | `/functions/api/admin/_middleware.js` | S |
| m5 | `Compare` in primary nav for low-intent first-timers; share-row Compare button takes space | every page + entry pages | S |
| m6 | Articles index dates suggest cadence not being kept (no posts since May 16) | `/articles/` | S (editorial decision) |
| m7 | `scroll-behavior: smooth` without prefers-reduced-motion gate | `/styles.css` | S |
| m8 | Daily entry colloq. definitions follow visible "A thiccc X of Y" pattern repetitively | content generator | M (prompt-engineer variety) |
| m9 | Staff portrait alt text says "eli portrait" — uninformative | `/about/masthead/` | S |
| m10 | `/follow/` page has wrong og:url + AboutPage schema name copy-pasted from /press/ | `/follow/index.html` | S |
| m11 | Inline highlightCcc function duplicated inside every entry HTML AND in external script | all entries | S |
| m12 | `localStorage` PWA banner code not wrapped in try/catch | `/index.html` | S |
| m13 | Straight quotes `"..."` instead of curly in example sentences | content generator | S |
| m14 | `.html.LATEST` files checked into repo | repo | S |
| m15 | A–Z and Archive presented as peer nav items doing similar work | nav | S |
| m16 | Newsletter no subscriber-count social proof | homepage signup | S |

### POLISH (low-impact niceties)

- Entry-grid 60/40 split favoring image
- Microcopy lift on "Submit for rating →" → "Plate it →"
- PWA banner copy in brand voice
- `_redirects` for trailing-slash normalization
- "What's new since last visit" banner for returning users
- Smart-quotes substitution in generator
- Staff bylines on daily entries (rotating)
- HTML lint step in CI

### Top 10 recommended fixes to ship

1. **B1 / M11 — `Plate N.` substitution + strip template-token comments.** One coordinated fix in `build-entry-pages.js`. Brand-promise blocker. S effort.
2. **M1 — Fix `/cartoons/` og:image URL typo.** Single character. S effort, immediate social-share recovery.
3. **M8 — Remove Instagram-`alert()` from homepage share row.** Replace with follow-link or drop entirely. S effort, removes a 2003-style UX failure.
4. **M5 — Drop the `target="popupwindow"` from Buttondown forms.** S effort. iOS subscribers currently going dark.
5. **M10 — Convert homepage share buttons to real `<a>` href + add aria-labels.** Backport the pattern already proven on entry pages. S effort.
6. **M9 — Add MIME-type validation client + server on `/api/submit`.** Wallet protection. S effort.
7. **M4 — Prerender today's entry into `index.html` at build time.** Kills the Boeing-flash. M effort, fixes CLS.
8. **M2 — Prerender A–Z page from `entries.json`.** Same generator pattern. M effort, fixes crawlability.
9. **M3 — Ship a baseline `_headers` file** (nosniff, referrer-policy, permissions-policy, baseline CSP allowing fonts/Pinterest/Buttondown). M effort, closes audit blockers.
10. **M6 — Backfill WebP variants + emit `<picture>` for entry images.** L effort but ~27 entries is finite; biggest mobile UX win.

