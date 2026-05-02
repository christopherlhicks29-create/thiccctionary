# 🚀 LAUNCH.md — Step-by-Step Go-Live Guide

This is the do-this-now checklist. Work top to bottom. Every step has a link, what to type/paste, and how to verify it worked. Total time: ~2 hours active, plus 30-60 min DNS wait.

If you get stuck on any step, paste the error back to Claude — I can debug.

---

## Phase 0 — Prerequisites (5 min)

You need:
- [ ] A GitHub account (free) — sign up at https://github.com if you don't have one
- [ ] A computer with `git` installed — check by running `git --version` in a terminal. If missing: https://git-scm.com/downloads
- [ ] A credit/debit card for OpenAI ($5 minimum) and Buffer ($6/mo). Other services here have free tiers.
- [ ] About 2 hours of focused time

Open this file in your editor and check items off as you go.

---

## Phase 1 — Generate the OG share image (3 min)

The OG image is what shows up when someone shares a Thiccctionary link on Twitter, Facebook, LinkedIn, iMessage, etc. We need a real PNG — SVG doesn't work in social scrapers.

- [ ] Double-click `og-image-generator.html` in this folder. It opens in your browser.
- [ ] Click **"Download og-default.png"**. Save it directly into this folder (`D:\Thiccctionary.com\Thiccctionary.com\`).
- [ ] Verify: you should now have `og-default.png` next to `index.html`.

---

## Phase 2 — Push the project to GitHub (15 min)

- [ ] Go to https://github.com/new
- [ ] Repository name: `thiccctionary`
- [ ] Set to **Public** (free GitHub Actions minutes are unlimited for public repos)
- [ ] Don't add a README/license/gitignore (we have them)
- [ ] Click **Create repository**
- [ ] Copy the HTTPS URL it shows you (looks like `https://github.com/YOUR_USERNAME/thiccctionary.git`)

Now from a terminal in this folder:

```bash
cd "D:\Thiccctionary.com\Thiccctionary.com"
git init
git add .
git commit -m "Initial Thiccctionary"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/thiccctionary.git
git push -u origin main
```

When git prompts you to authenticate, use a personal access token (GitHub no longer accepts passwords). Generate one at https://github.com/settings/tokens — give it `repo` and `workflow` scopes.

- [ ] Verify: visit `https://github.com/YOUR_USERNAME/thiccctionary` — you see all your files.

---

## Phase 3 — Deploy to Cloudflare Pages (15 min)

- [ ] Go to https://dash.cloudflare.com/sign-up if you don't have an account, otherwise sign in
- [ ] In the left sidebar: **Workers & Pages** → **Create application** → **Pages** tab → **Connect to Git**
- [ ] Authorize Cloudflare to access your GitHub
- [ ] Pick the `thiccctionary` repo
- [ ] **Build settings:**
  - Framework preset: **None**
  - Build command: leave blank
  - Build output directory: `/`
- [ ] Click **Save and Deploy**
- [ ] Wait ~30 seconds. You'll get a URL like `thiccctionary-abc.pages.dev`
- [ ] Click that URL — you should see the Thiccctionary homepage

If it loads, the static site is live on Cloudflare's CDN. Now we point your domain at it.

---

## Phase 4 — Point thiccctionary.com at Cloudflare (10 min + DNS wait)

- [ ] In Cloudflare Pages, open your project → **Custom domains** tab → **Set up a custom domain**
- [ ] Enter `thiccctionary.com` → click **Continue**
- [ ] Cloudflare shows you DNS records to add (a CNAME or A record)
- [ ] Open Squarespace in another tab → **Domains** → click `thiccctionary.com` → **DNS settings**
- [ ] Add the records Cloudflare gave you. (If Squarespace allows nameserver change, that's even cleaner — Cloudflare provides two nameservers; replace Squarespace's nameservers with those.)
- [ ] Repeat for `www.thiccctionary.com` (add the same record with the `www` prefix)
- [ ] Save in Squarespace
- [ ] Wait 10-60 minutes for DNS to propagate. You can check status with https://dnschecker.org/?type=A&query=thiccctionary.com
- [ ] Verify: visit `https://thiccctionary.com` — homepage loads with the lock icon (HTTPS auto-provisioned by Cloudflare)

You can now cancel the Squarespace subscription. **Keep the domain registration** — don't let it expire. Optionally transfer it to Cloudflare for $9/yr.

---

## Phase 5 — Wire up the daily AI generator (20 min)

### 5a. Get an OpenAI API key

- [ ] Go to https://platform.openai.com/signup (or sign in)
- [ ] Settings → Billing → **Add payment method**, then add at least $5
- [ ] Go to https://platform.openai.com/api-keys → **Create new secret key**
- [ ] Copy the key (starts with `sk-...`). You can only see it once. Paste it somewhere temporarily.

### 5b. Get an Unsplash API key

- [ ] Go to https://unsplash.com/developers
- [ ] **Register as a developer** (free)
- [ ] **New Application** → accept terms → name it "Thiccctionary"
- [ ] Copy your **Access Key**. (Ignore the Secret Key — we don't need it.)

### 5c. Add the secrets to GitHub

- [ ] In your GitHub repo: **Settings** → **Secrets and variables** → **Actions**
- [ ] Click **New repository secret** for each:
  - Name: `OPENAI_API_KEY`, value: your sk-... key
  - Name: `UNSPLASH_ACCESS_KEY`, value: your Unsplash access key
- [ ] Switch to the **Variables** tab → **New repository variable**:
  - Name: `SITE_BASE_URL`, value: `https://thiccctionary.com`

### 5d. Run the daily workflow manually as a test

- [ ] In your repo: **Actions** tab → **"Daily Thiccc — Generate Draft PR"** in the left sidebar
- [ ] Click **Run workflow** → confirm
- [ ] Wait ~2 minutes. Watch the workflow run; it should turn green
- [ ] You'll see a new **Pull Request** appear: `📖 [Subject Name] — YYYY-MM-DD`
- [ ] Open it, click **Files changed** — you'll see the new image and the JSON entry
- [ ] If you like it, click **Squash and merge**. Cloudflare Pages auto-deploys in ~60 seconds.
- [ ] Visit thiccctionary.com — your AI-generated entry is now today's featured entry

If the workflow fails, click into the failed step to see logs. Common fixes:
- "Insufficient quota" → add more $ to OpenAI billing
- "Unauthorized" → secret name is misspelled or value is wrong
- "No Unsplash results for query" → just re-run; the AI picked an obscure subject

---

## Phase 6 — Reader submissions via Formspree (10 min)

- [ ] Go to https://formspree.io and sign up (free tier: 50 submissions/mo)
- [ ] Click **+ New Form** → name it "Thiccctionary Submissions" → set the email it should forward to (your email)
- [ ] Copy the form's endpoint URL — looks like `https://formspree.io/f/abc123xyz`. The ID is the `abc123xyz` part.
- [ ] Open `submit.html` in your editor. Find the line:
   ```html
   <form class="submit-form" action="https://formspree.io/f/YOUR_FORMSPREE_ID" method="POST">
   ```
- [ ] Replace `YOUR_FORMSPREE_ID` with your actual ID
- [ ] Save, commit, push:
   ```bash
   git add submit.html
   git commit -m "Wire up submit form"
   git push
   ```
- [ ] Cloudflare auto-deploys in ~60s
- [ ] Verify: visit `thiccctionary.com/submit.html`, fill in a test entry, hit submit. You should get an email at your configured address. The first submission requires you to click a confirmation link Formspree sends.

---

## Phase 7 — Newsletter via Buttondown (10 min)

- [ ] Go to https://buttondown.com and sign up (free tier: 100 subscribers)
- [ ] Settings → Embed → copy the form's HTML
- [ ] In `index.html`, find the existing newsletter form (search for `signup-form`):
   ```html
   <form class="signup-form" onsubmit="event.preventDefault(); alert('Email signup not yet wired — see README for setup.');">
   ```
- [ ] Replace with:
   ```html
   <form class="signup-form" action="https://buttondown.email/api/emails/embed-subscribe/YOUR_BUTTONDOWN_USERNAME" method="post" target="popupwindow" onsubmit="window.open('https://buttondown.email/YOUR_BUTTONDOWN_USERNAME', 'popupwindow')">
   ```
   (Replace `YOUR_BUTTONDOWN_USERNAME` with your actual Buttondown username, twice.)
- [ ] Commit, push.
- [ ] Verify: enter a test email on the homepage. A new tab opens to confirm subscription. Check your Buttondown dashboard — subscriber appears.

---

## Phase 8 — Social media accounts (45 min)

This is the longest phase because of Instagram's Business Account requirement.

### 8a. Create the accounts

- [ ] **Instagram:** create `@thiccctionary` as a personal account first, then convert it to a Business account in Settings → Account → Switch to Professional Account → Business
- [ ] **Facebook Page:** create one called "Thiccctionary" — https://www.facebook.com/pages/create
- [ ] In Instagram settings, **link your IG to that Facebook Page** (Settings → Accounts Center → Linked accounts)
- [ ] **Twitter/X:** create `@thiccctionary` at https://x.com

For all three, set the bio to something like "A satirical daily dictionary of objects of unusual girth. New entry every morning." Add `thiccctionary.com` as the website link. Use the same OG image as the profile pic for now.

### 8b. Buffer

- [ ] Go to https://buffer.com → sign up
- [ ] Pick the **Essentials** plan ($6/mo) — required for auto-publish on Instagram
- [ ] **Connect channels:** add IG, FB Page, Twitter inside Buffer. Each opens an OAuth flow on the respective platform.
- [ ] For each connected channel, click into its Buffer profile. The URL will contain the profile ID — looks like `buffer.com/app/profile/5e1abc.../updates`. Copy the `5e1abc...` part for each of the three.

### 8c. Buffer access token

- [ ] Go to https://buffer.com/developers/api/oauth
- [ ] Create an application (any name/URL works)
- [ ] Click **Create Access Token** for that application — copy it

### 8d. Add Buffer secrets to GitHub

- [ ] In your GitHub repo: Settings → Secrets and variables → Actions
- [ ] New repository secret:
  - Name: `BUFFER_ACCESS_TOKEN`, value: the token from 8c
- [ ] Another:
  - Name: `BUFFER_PROFILE_IDS`, value: the 3 IDs comma-separated, e.g. `5e1abc,5e2def,5e3ghi`

### 8e. End-to-end test

- [ ] Run the daily workflow manually again (Phase 5d)
- [ ] Merge the resulting PR
- [ ] Wait ~90 seconds — the `post-on-merge.yml` workflow runs (visible in Actions tab)
- [ ] Open Buffer's queue → your post should be there with image + caption + link
- [ ] Buffer's default behavior is to add posts to your queue. To publish immediately, configure each profile's posting schedule in Buffer (Profile → Settings → Posting Schedule)

---

## Phase 9 — Verification (15 min)

After everything's wired up, click through this checklist on a fresh browser tab:

- [ ] `https://thiccctionary.com` — homepage loads, shows today's entry
- [ ] Click the headword → goes to `entries/YYYY-MM-DD.html` page
- [ ] Click "The Archive" → `archive.html` shows all entries; search box filters
- [ ] Type a partial word in archive search → results filter
- [ ] Click "Submit a Thiccc" → submit page loads, form submits successfully
- [ ] Visit `thiccctionary.com/random.html` → redirects to a random entry
- [ ] Visit `thiccctionary.com/something-not-real` → shows the branded 404 (this requires Cloudflare Pages to use 404.html as the 404 — check your Pages project Settings → Build & deployments → "Custom 404" if it doesn't auto-detect)
- [ ] On a phone: site is responsive
- [ ] Share a link in iMessage / Slack / Twitter — the OG image preview shows
- [ ] Wait until tomorrow 13:00 UTC — daily PR should auto-open without you doing anything

---

## You are now live.

**What happens next, on autopilot:**

Every day at 13:00 UTC, GitHub Actions:
1. Picks a subject the AI hasn't covered
2. Searches Unsplash for photos
3. Vision-picks the chunkiest one
4. Writes the satirical entry
5. Builds the per-entry HTML page
6. Updates sitemap
7. Opens a PR

You get a GitHub notification on your phone. You tap, review, merge. Cloudflare deploys. Buffer queues the social post. Done.

**What you do manually:**

- Reply to comments / DMs on social. Don't automate this — it gets accounts flagged.
- Once a week, scan the archive for entries that flopped or are too obscure. Just delete them via a quick PR.
- Once a month, eyeball the AI's picks for quality drift. Tweak the system prompt in `scripts/generate-daily.js` if needed.

**When to spend more money:**

You're at ~$7.50/mo. Don't increase spend until you have signals worth investing in:

| Trigger | Spend | What it gets you |
|---|---|---|
| 100+ daily site visitors | $9/mo Plausible | Real analytics |
| Newsletter passes 100 subs | $9/mo Buttondown paid | Continued growth |
| Posts getting >100 likes | $12/mo Buffer Team | Multiple posts/day |
| Site traffic spikes from a viral moment | $20/mo Cloudflare Pro | DDoS protection, better caching |

You're nowhere close to needing any of these yet. Stay lean.

---

## Troubleshooting

**Daily workflow fails with "OPENAI_API_KEY not set"**
→ Secret name is wrong. Must be exactly `OPENAI_API_KEY`. Check Settings → Secrets.

**PR opens but image is blank/broken**
→ Unsplash returned weird results. Re-run the workflow. If persistent, check Unsplash key validity.

**Buffer post doesn't fire after merge**
→ Check the `post-on-merge.yml` workflow logs. Most common: PR wasn't labeled `daily-entry` (it should auto-label). Manually add the label and re-merge.

**Custom 404 doesn't show on Cloudflare**
→ Cloudflare Pages auto-uses `404.html` if it exists at the root. If it's not working: Pages → Settings → Functions → Compatibility flags. Or rename to `_404.html`. (Honestly rare; should "just work.")

**Instagram rejects Buffer connection**
→ Account must be Business, not Personal or Creator. AND it must be linked to a Facebook Page. Both required.

**DNS hasn't propagated after 1 hour**
→ Most common cause: didn't fully replace Squarespace's records. Use https://dnschecker.org to confirm what's resolving. If still pointing to Squarespace, the DNS records weren't saved correctly.

---

When you hit any error, paste the exact text into Claude. I can debug specific failures faster than reading docs.
