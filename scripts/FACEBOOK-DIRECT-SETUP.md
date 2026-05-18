# Direct Facebook posting setup

The social workflows now post to Facebook via Meta's Graph API directly,
which removes the "Published by Buffer" attribution. Buffer continues
to handle Instagram and X/Twitter.

While the Facebook secrets are not yet set, **nothing breaks** , 
`scripts/post-to-facebook.js` exits 0 silently when secrets are missing,
and Buffer's FB channel still fires as a fallback (because
`SKIP_FACEBOOK` is also gated). Once you complete the steps below and
the secrets are present, FB posts route through the direct path
automatically.

## What you need to do (~10 minutes, one-time)

### 1. Create a Facebook App

1. Go to https://developers.facebook.com/apps/
2. Click **Create App** → choose **Business** → name it `Thiccctionary`
3. Add product: **Facebook Login for Business** (you don't need to configure
   it; just having the product enabled gives you Pages API access).

### 2. Get a long-lived Page Access Token

1. In the app dashboard → **Tools** → **Graph API Explorer**.
2. Top right, switch the dropdown to your `Thiccctionary` app.
3. Click **Generate Access Token** → log in if needed.
4. In the **Permissions** dropdown, add:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `pages_show_list`
5. Click **Generate Access Token** again. Confirm. You'll get a
   **short-lived User token** (1-hour expiry).
6. Exchange it for a **long-lived User token** (60-day expiry):
   ```
   https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<short_lived_token>
   ```
   Replace `<APP_ID>` and `<APP_SECRET>` with values from the app dashboard.
7. Use the long-lived User token to fetch a **Page Access Token** (which
   never expires):
   ```
   https://graph.facebook.com/v21.0/me/accounts?access_token=<long_lived_user_token>
   ```
   The response lists your Pages. Find the Thiccctionary Page entry.
   Copy its `access_token` field, that's the **never-expiring Page
   Access Token** we'll use. Also note the `id` field, that's the Page ID.

### 3. Add the secrets to GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret.
Add two:

- **`FB_PAGE_ACCESS_TOKEN`**, the never-expiring Page token from step 2.7
- **`FB_PAGE_ID`**, the Page ID from the same response

### 4. Verify

Trigger a manual fire, push any small change to `data/.fire-buffer` , 
and watch the workflow run in the Actions tab. The new
"Post to Facebook (direct, no Buffer attribution)" step will run before
Buffer; if your secrets are correct, it succeeds and the FB post shows
up on the Page **without** the "Published by Buffer" tag.

## What if I want to roll back?

Two reversal paths:

1. **Soft rollback:** delete `FB_PAGE_ACCESS_TOKEN` and `FB_PAGE_ID` from
   GitHub Secrets. The direct script exits 0 silently on missing secrets,
   Buffer's FB channel takes over again.

2. **Hard rollback:** revert the commit that added these workflow steps
   (look for "Direct Facebook posting" in the git log). This removes
   the FB-direct step and the `SKIP_FACEBOOK` env var entirely.

## What the FB attribution will say after this

Meta attributes posts to the **registered app name**. Since we registered
the app as "Thiccctionary," Facebook will show "Published by Thiccctionary"
underneath the page name on direct-API posts, owned, on-brand, no
third-party tool name.
