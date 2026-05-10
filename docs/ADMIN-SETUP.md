# Admin Panel Setup — Cloudflare Access

The admin panel at `https://thiccctionary.com/admin/` is functional but **inert until Cloudflare Access is configured**. Without Access, every API call returns 401 with setup instructions.

This is one-time, ~15 minutes.

## Why this matters

- Without auth, the admin endpoints would be publicly accessible — anyone could approve/reject submission PRs
- Cloudflare Access is free for up to 50 users on the Free plan
- It uses your existing Cloudflare account (no new vendor)

## Steps

### 1. Open Cloudflare Zero Trust dashboard

Go to https://dash.cloudflare.com → click your account → click **Zero Trust** in the left sidebar (or visit https://one.dash.cloudflare.com directly).

If this is your first time, Zero Trust will ask you to pick a team name (e.g., `thiccctionary`). Pick anything; it's just for the URL.

### 2. Create an Access application

In Zero Trust:
- Left sidebar → **Access** → **Applications**
- Click **Add an application**
- Choose **Self-hosted**

Fill in:
- **Application name:** `Thiccctionary Admin`
- **Session Duration:** `24 hours` (your choice)
- **Application domain:**
  - Subdomain: leave blank (or `www`, depending on your setup)
  - Domain: `thiccctionary.com`
  - Path: `admin/*`

Click **Next**.

### 3. Add a policy

- **Policy name:** `Christopher only`
- **Action:** `Allow`
- **Configure rules:**
  - **Include** → **Emails** → enter `christopher.l.hicks29@gmail.com`

Click **Next** → **Add application**.

### 4. Test it

Open https://thiccctionary.com/admin/ in an incognito window.

You should see Cloudflare's login page asking for your email. Enter `christopher.l.hicks29@gmail.com`. Cloudflare will email you a one-time PIN (or use your linked identity provider if you set one up). Enter the PIN.

After successful auth, you should see the admin dashboard with any open submission PRs.

### 5. Optional — link your Google account

Instead of one-time PINs by email, you can link a Google identity provider:
- Zero Trust → **Settings** → **Authentication** → **Login methods** → add **Google**
- Follow the Google OAuth setup steps (~5 min)
- Update your Access policy to use Google as the identity source

This means visiting `/admin/` will redirect you to Google sign-in, and after signing in you're logged into the admin for the session duration.

## What the admin can do (V1)

- **List open submission PRs** with image preview, definitions, etymology
- **Approve & publish** — merges the PR, which auto-deploys the entry and fires the social + newsletter pipeline
- **Reject** — closes the PR and deletes the branch (R2 image stays orphaned; clean up via R2 dashboard if you want)

## What the admin DOES NOT do yet

These are queued for V2 if you find the V1 useful:
- System status panel (last cron, last reel, watchdog state, Buffer queue)
- Quick-fire actions (manual cron, reel rebuild, backfill)
- Inline entry editing (use GitHub PR UI for now)
- Site-health dashboard

## Troubleshooting

**"Cloudflare Access is not configured"** in the admin page → finish the Access setup above.

**"Forbidden — access restricted"** → the email Cloudflare authenticated isn't `christopher.l.hicks29@gmail.com`. Check the policy rule.

**API errors 502/503** → likely the GITHUB_PAT secret expired or was revoked. Regenerate at https://github.com/settings/tokens and update in Cloudflare Pages → Settings → Environment variables.
