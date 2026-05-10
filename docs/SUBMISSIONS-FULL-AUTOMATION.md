# Submissions Full Automation — Setup

The `/api/submit` Pages Function (Wave 52) replaces Formspree. User submissions now flow end-to-end:

1. Form posts directly to `/api/submit` (no Formspree)
2. Function stores image in R2
3. Vision check rejects person/animal subjects
4. Entry text generated via OpenAI with banned-words retry
5. Auto-commits entry to `data/entries.json` via GitHub API
6. Cloudflare auto-deploys; entry is live within ~60 seconds

## One-time setup needed

You need to add **one new env var** in Cloudflare Pages: `GITHUB_PAT`.

### Step 1: Generate a GitHub fine-grained PAT

1. Go to https://github.com/settings/personal-access-tokens/new
2. **Token name:** `thiccctionary-submissions-pages-function`
3. **Expiration:** 90 days (set a calendar reminder to rotate)
4. **Repository access:** Only select repositories → choose `christopherlhicks29-create/thiccctionary`
5. **Permissions → Repository permissions:**
   - **Contents:** Read and write
   - (everything else: No access)
6. Click **Generate token**
7. Copy the token immediately (you won't see it again).

### Step 2: Add the token to Cloudflare Pages

1. Cloudflare → Pages → thiccctionary → Settings → Variables and Secrets
2. **Add Production variable:**
   - Name: `GITHUB_PAT`
   - Value: paste the token
   - Type: **Encrypted** / Secret (so it's not visible after save)
3. Add a second variable:
   - Name: `GITHUB_REPO`
   - Value: `christopherlhicks29-create/thiccctionary`
   - Type: Plaintext
4. Save.

### Step 3: Trigger a redeploy

Push any commit (or click "Retry deployment" on the latest Pages build) so the new env vars take effect.

### Step 4: Test

Visit https://thiccctionary.com/submit.html, submit a real photo of a thing.

Expected: 20-30 second processing, then redirect to `/thanks.html?word=...`. New entry visible at `https://thiccctionary.com/entries/YYYY-MM-DD.html` within another minute (after Cloudflare rebuilds).

## What gets rejected automatically

- Photos where vision API determines primary subject is a person or animal — friendly message tells the submitter to try an object
- Photos where the model can't produce clean entry text after 3 attempts — saved for manual review (you'll need to check the R2 bucket for orphan submissions periodically; can add a dashboard later)

## Limits

- 10 MB image max
- ~$0.02-0.05 per submission in OpenAI costs (vision check + entry generation)
- No rate limit on the endpoint yet — may need IP-based throttling if abused

## Costs of running this

- R2: free up to 10 GB
- OpenAI: roughly $1 per 30-50 submissions
- Pages Functions: free tier covers 100K invocations/day

## Rollback

If something breaks, revert the form's `action` from `/api/submit` back to `https://formspree.io/f/mrejbrkk` in submit.html. The Formspree pipeline still works as a fallback (just doesn't auto-publish).

