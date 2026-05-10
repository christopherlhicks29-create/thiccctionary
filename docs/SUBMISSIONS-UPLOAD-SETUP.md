# Submissions Upload Setup — Cloudflare R2

The `/api/upload` Pages Function accepts file uploads from the Submit a Thiccc form and stores them in Cloudflare R2. This document covers the one-time Cloudflare setup needed to activate it.

**Status until this is done:** the file input on submit.html will show "Upload error: R2 bucket not configured." Visitors can still use the "Or paste a URL instead" fallback.

## One-time setup (~3 minutes)

### Step 1: Create the R2 bucket

1. Open https://dash.cloudflare.com/?to=/:account/r2
2. Click **Create bucket**
3. Name: `thiccctionary-submissions`
4. Location: Automatic (or pick a US region)
5. Click **Create bucket**

### Step 2: Enable public access on the bucket

1. Inside the new bucket, click the **Settings** tab
2. Find **Public access**
3. Click **Allow access** under "Custom domains" or "R2.dev subdomain" (R2.dev is faster to set up)
4. Confirm the warning about public access

### Step 3: Bind the bucket to Pages

1. Open https://dash.cloudflare.com/?to=/:account/pages
2. Click **thiccctionary** project
3. Go to **Settings → Bindings** (or Functions → R2 bucket bindings on older UIs)
4. Click **Add binding** → **R2 bucket**
5. Variable name: `SUBMISSIONS_BUCKET`
6. R2 bucket: `thiccctionary-submissions`
7. Click **Save**

### Step 4: Set the public URL env var

1. Same Settings page, find **Environment variables**
2. Add a Production variable:
   - Name: `SUBMISSIONS_PUBLIC_URL`
   - Value: the R2.dev URL or custom domain from Step 2
     (looks like `https://pub-xxxxxxxx.r2.dev`)
3. Click **Save**

### Step 5: Trigger a redeploy

The bindings take effect on the next deploy. Either:
- Push any commit to main, OR
- Click **Retry deployment** on the latest Pages deployment

### Step 6: Test

1. Open https://thiccctionary.com/submit.html
2. Pick a small test image
3. Should show "✓ Uploaded" within a few seconds

If it shows an error, check Cloudflare Pages → Functions → Real-time logs while testing for the actual error.

## Why R2 instead of Cloudinary or ImgBB

- No third-party signup
- Uses your existing Cloudflare account
- Free up to 10 GB storage + Class A operations
- Full control over what's stored and how it's purged
- Compatible with future moves to per-submission moderation pages

## Limits

- 10 MB per upload (enforced by the function)
- Only image MIME types accepted (also enforced)
- Files are public-readable (anyone with the URL can view)
- No auth on the upload endpoint (anyone can post images) — moderate via Formspree submission review
