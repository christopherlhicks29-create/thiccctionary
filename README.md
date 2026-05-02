# Thiccctionary.com

A satirical daily dictionary of objects of unusual girth. Every morning, a script picks a subject (e.g. "Concrete Mixer Truck"), pulls candidate photos from Unsplash, asks GPT-4o-mini-vision which one looks chunkiest, writes a satirical dictionary entry around it, generates a per-entry HTML page with proper Open Graph tags, updates the sitemap, and opens a Pull Request for your review.

You merge the PR with one tap on your phone. Site auto-deploys, social posts auto-fire.

## Pipeline at a glance

```
13:00 UTC daily
    ↓
[GitHub Actions: daily.yml]
    ↓ AI picks subject → Unsplash search → vision picks photo → AI writes entry
    ↓ Builds entries/YYYY-MM-DD.html and updates sitemap.xml
    ↓
Opens a Pull Request labeled "daily-entry"
    ↓
You review on GitHub mobile (image preview + diff)
    ↓ tap "Squash and merge"
    ↓
[GitHub Actions: post-on-merge.yml]
    ↓ Cloudflare Pages auto-deploys site (~60s)
    ↓ Buffer posts to IG / FB / X
    ↓
Live.
```

## What's in this repo

```
/
├── index.html                   ← homepage with today's entry
├── archive.html                 ← searchable archive
├── submit.html                  ← reader submission form
├── random.html                  ← redirects to a random entry
├── 404.html                     ← branded not-found page
├── styles.css                   ← all styling
├── favicon.svg
├── robots.txt
├── sitemap.xml                  ← regenerated daily by the script
├── og-default.png.svg           ← convert to og-default.png for prod
├── data/
│   └── entries.json             ← every entry, newest first (the source of truth)
├── images/                      ← entry images (one per day, plus 6 SVG seed placeholders)
├── entries/
│   ├── _template.html           ← per-entry page template (don't deploy this directly)
│   └── YYYY-MM-DD.html          ← one static HTML page per entry, with OG meta
└── scripts/
    ├── generate-daily.js        ← daily generation (Unsplash + AI vision)
    ├── build-entry-pages.js     ← rebuilds entry HTML pages from entries.json
    ├── post-to-buffer.js        ← social posting on PR merge
    └── package.json
└── .github/
    └── workflows/
        ├── daily.yml            ← cron: opens daily PR
        └── post-on-merge.yml    ← on merge: Buffer post
```

The site is plain static HTML/CSS/JS. No build framework. The "build" is just `node scripts/build-entry-pages.js`, which regenerates the per-entry pages and the sitemap from `data/entries.json`. Run it whenever you change the template.

---

## Going live — full launch checklist

### Phase 1 — Get the prototype on the internet (~ 1 hour)

**1. Push this folder to GitHub**

```bash
git init
git add .
git commit -m "Initial Thiccctionary"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/thiccctionary.git
git push -u origin main
```

**2. Convert the OG image**

`og-default.png.svg` is a placeholder. Open it in a browser, take a 1200×630 screenshot, save as `og-default.png` in the project root, and commit. (Or use any online SVG-to-PNG converter set to 1200×630.) Twitter and Facebook OG scrapers don't reliably render SVG, so PNG is required.

**3. Deploy to Cloudflare Pages (free)**

- https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
- Select your `thiccctionary` repo
- Build command: leave blank
- Build output directory: `/`
- Click Deploy. You get a `*.pages.dev` URL in ~30 seconds.

**4. Point thiccctionary.com at Cloudflare**

- Cloudflare Pages → your project → Custom domains → Set up custom domain
- Add `thiccctionary.com` and `www.thiccctionary.com`
- Cloudflare provides DNS records (or recommends nameserver switch)
- In Squarespace: Domains → thiccctionary.com → DNS settings → apply Cloudflare's records
- Wait 10-60 minutes; visit thiccctionary.com — live.

You can cancel Squarespace at this point. Keep the domain registration; transfer it to Cloudflare later for $9/yr if you want.

### Phase 2 — Wire up the daily automation (~ 30 minutes)

**1. Get an Unsplash API key (free)**

- https://unsplash.com/developers → register as a developer → New Application
- Free tier: 50 req/hour. We use ~3/day. Plenty.

**2. Get an OpenAI API key**

- https://platform.openai.com/api-keys → create. Add at least $5. Daily cost ~$0.05.

**3. Add secrets to GitHub**

Settings → Secrets and variables → Actions:

**Secrets:**
- `OPENAI_API_KEY`
- `UNSPLASH_ACCESS_KEY`

**Variables** (different tab):
- `SITE_BASE_URL` = `https://thiccctionary.com`

**4. Test it**

Actions tab → "Daily Thiccc — Generate Draft PR" → Run workflow. ~1-2 min later a PR appears titled `📖 [Subject] — YYYY-MM-DD`. Open it, review the image and copy in **Files changed**. If you like it, click **Squash and merge**. Site deploys in ~60s.

If you hate it, close the PR. Re-run the workflow to try again.

The cron then runs daily at 13:00 UTC. To change the time edit `.github/workflows/daily.yml` (use https://crontab.guru for cron syntax).

### Phase 3 — Social media (~ 1 hour)

**1. Create the social accounts**

- Instagram `@thiccctionary` as a **Business** account (required for Buffer auto-publish). Link to a new Facebook Page.
- Facebook Page Thiccctionary
- Twitter/X `@thiccctionary`

Bio on each: "satirical dictionary of objects, updated daily." Anything ambiguous about bodies gets flagged.

**2. Buffer**

https://buffer.com → Essentials plan ($6/mo) covers all 3 channels. Connect IG, FB, Twitter. Note each profile's ID (in the URL when you click into a profile).

**3. Buffer access token**

https://buffer.com/developers/api/oauth → create application → grab access token.

**4. Add to GitHub secrets**

- `BUFFER_ACCESS_TOKEN` (secret)
- `BUFFER_PROFILE_IDS` (secret) — comma-separated, e.g. `5e1a...,5e2b...,5e3c...`

**5. Test**

Run the workflow → merge the PR → wait ~90s → check Buffer's queue. Post should appear with image and copy.

### Phase 4 — Reader submissions (~ 5 minutes)

1. Sign up at https://formspree.io (free tier: 50 submissions/mo)
2. Create a new form, copy your form ID
3. In `submit.html`, replace `YOUR_FORMSPREE_ID` (line ~37) with that ID
4. Commit and push. The submit form now emails you on every submission.

### Phase 5 — Newsletter (when ready)

The footer signup currently shows an alert. To wire up a real newsletter:

1. Sign up at https://buttondown.com (free tier: up to 100 subscribers)
2. Buttondown → Settings → Embed code → copy the form's action URL
3. In `index.html`, replace the form's `onsubmit` with `action="https://buttondown.email/api/emails/embed-subscribe/YOUR_USERNAME" method="post" target="popupwindow"`

### Phase 6 — Advertising (after 100+ daily visits)

Don't bother before then. AdSense earns ~$0.50–$3 per 1,000 visits. For a niche satire site, **merch via Printful + Shopify** ($0 upfront) often outperforms ads.

---

## Running locally

```bash
# View the site:
python3 -m http.server 8000
# → http://localhost:8000

# Rebuild all per-entry pages from entries.json:
cd scripts && npm install
node build-entry-pages.js

# Generate today's entry manually:
OPENAI_API_KEY=sk-... UNSPLASH_ACCESS_KEY=... node generate-daily.js

# Force a specific subject:
SUBJECT_OVERRIDE="Vintage Cadillac DeVille" node generate-daily.js
```

---

## Costs

| Item                   | Monthly       | Notes                                   |
|------------------------|---------------|-----------------------------------------|
| Domain                 | already owned | thiccctionary.com                       |
| Cloudflare Pages       | $0            | free tier                                |
| GitHub                 | $0            | public repo                              |
| Unsplash API           | $0            | free tier                                |
| OpenAI text + vision   | ~$1.50        | gpt-4o-mini × 3 calls/day               |
| Buffer Essentials      | $6.00         | IG + FB + X                              |
| Formspree              | $0            | free tier (50/mo)                        |
| Buttondown             | $0            | free tier (100 subs)                     |
| **Total**              | **~$7.50/mo** | well under the $25 ceiling              |

---

## How the AI vision pipeline works

1. **Subject pick.** GPT-4o-mini gets the 30 most recent entry words and is told to suggest something not on it. Returns: subject (display name), unsplashQuery, category.
2. **Unsplash search.** API returns up to 30 squarish photos, content-filter set high.
3. **Vision evaluation.** First 12 candidates sent to GPT-4o-mini in a single multimodal call (low-detail thumbnails — pennies). Picks the chunkiest. Avoids photos with people, watermarks, or product-render aesthetics.
4. **Entry generation.** Subject + chosen photo's caption + photographer go to GPT-4o-mini, which writes the dictionary entry. The model never references humans or anatomy in output (system prompt enforces this).
5. **Save.** Image downloads to `images/YYYY-MM-DD.jpg`. Entry appended to `data/entries.json`. Per-entry HTML page rendered to `entries/YYYY-MM-DD.html`. Sitemap rebuilt. Unsplash's `download_location` ping fires (their guidelines require this).

---

## Risks worth watching

- **Unsplash subject availability.** If GPT picks an obscure subject, Unsplash may return zero photos and the script errors. The next day's run will retry with a fresh subject. If it happens repeatedly, narrow the categories in `pickSubject()`.
- **Vision picker quality.** Some days the AI picks a boring photo. Re-run from the Actions tab to regenerate.
- **Meta moderation.** Even satire about chunky planes can get auto-flagged. Keep captions object-focused. No body-related hashtags. If posts get removed, don't appeal — move on.
- **Unsplash attribution.** Photographer credit shows on every entry page (Unsplash license requirement). Don't remove it.
- **Burnout.** Plan a Phase 7 — themed weeks ("Heavy Equipment Week"), tournaments ("Thiccc of the Year"), guest editors — before the format goes stale at the 6-month mark.
- **Seed entries use SVG placeholders.** The 6 entries seeded with `images/sample-N.svg` are placeholders. The OG share cards for those will look like brand graphics, not photos. After the daily generator runs for ~6 days, all visible entries will have real Unsplash photos. If you want to force-replace the seeds sooner, run `SUBJECT_OVERRIDE="..." node generate-daily.js` six times after Phase 2 setup.

---

## What's not built yet

- Per-entry social copy variation (currently same caption all 3 platforms)
- Themed-week tagging (just a `tags` array right now)
- Newsletter integration (placeholder form)
- Per-entry custom OG image generation (entry uses its photo as OG image — works but not ideal at very small thumbnail sizes)
- Comments / engagement (intentional — adds moderation burden)

— Ship something. The first version doesn't have to be the right version.
