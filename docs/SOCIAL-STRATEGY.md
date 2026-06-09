# Thiccctionary Social Strategy — views first, money downstream

Owner: Claude (PM/PO). Drafted 2026-06-08. Christopher's directive: "Find a way to move toward getting views and eventually making money. Make it fun and relatable... not just regurgitations of the website."

## The honest current-state audit

What's working:
- The per-entry `socialCaptions` (Wave 89) are actually good. The deadpan register lands ("Walks slowly. Walks anyway. The horizon adjusts."). The writing is not the problem.
- There's a daily reel pipeline (deadpan onyx voice MP4) and a TikTok presence. That's the real reach asset and it's underused.

What's broken or missing:
1. **The image poster is failing.** `post-to-buffer.js` builds image posts with `assets:{images:[...]}`, but Buffer's API wants `image:{url}` (same bug just fixed in the panel script). Morning/afternoon/evening/article image posts error out; only Reels (which use the `video` field) get through. So most static output is silently failing. **This is the #1 fix.**
2. **Everything links out.** Every post ends with a URL and "today's entry." That's an ad. Social audiences scroll past ads. There's no reason to follow the account vs. bookmark the site.
3. **No engagement formats.** No polls, no "rate it," no POV, no caption-this. Likes are vanity; saves, shares, and replies are what the algorithms reward, and we ask for none of them.
4. **No face.** Nothing to follow. The accounts are an RSS feed of the website in a trench coat.

## The strategy in one line

**Short-form video for reach, native engagement formats for follows, deadpan voice as the moat. Do not monetize until there's an audience to monetize.**

## Where the stress-test lands on "making money"

The fastest way to kill this brand is to monetize before there's an audience: link-out spam, premature merch, display ads on a no-traffic site. Each of those trades a little reach for ~$0 and makes the accounts look desperate. The discipline for the next 90 days is to **resist monetizing and pour everything into reach and follows.** Money is downstream of audience, not a parallel track. (This is the same reason I recommended holding the merch test.)

Realistic money ladder, audience-gated:
- **0–5k followers/platform:** build only. Keep the existing tip jar; otherwise no asks.
- **5k–20k:** merch test becomes a *real* signal; launch a single SKU. Grow the newsletter (Buttondown already wired).
- **20k+:** brand partnerships (heavy-equipment, food, and "big object" brands are a comedically perfect fit), creator-fund payouts, and the book as the premium artifact.

## What actually drives each goal

- **Views (discovery):** short-form vertical video, posted *natively* to TikTok + Reels + Shorts (not cross-linked), strong visual hook in the first 1.5 seconds, trending-audio awareness, consistent daily cadence. Static posts mostly reach existing followers; video reaches strangers.
- **Engagement (signal to the algorithm):** "rate the thicccness 1–10," "is it thiccc? — vote, then we rule," POV/"nobody:" relatable setups, caption-this, spicy rankings ("the 5 thicccest machines, and we won't be taking questions").
- **Follows (a reason to come back):** a recurring character + anticipated series. The "social desk" persona — an intern running the accounts, perpetually submitting objects the Senior Cataloguer rejects — gives the feed a face and an ongoing bit you can't get on the site.

## The "social desk" persona (the followable face)

Canon-consistent with the masthead: the publication is too dignified to run its own social accounts, so it handed them to an unpaid intern. The intern reveres the deadpan house style but is looser, more online, and openly feuding with the Senior Cataloguer (who keeps filing objections to the intern's submissions). This gives us:
- Permission to use native/online formats while staying on-brand (the intern is doing the meme; the institution would never).
- An ongoing soap opera (office politics, rejected submissions, the intern's campaigns) that rewards following.
- A clean voice split: the *site* is the buttoned-up institution; the *feed* is the intern. Deadpan academic meeting "rate this 1–10" is the edge no other meme page has.

## Content pillars (weekly mix)

1. **Daily Reel** (reach engine) — the existing deadpan-voice video, hook-first, posted native to TikTok/Reels/Shorts.
2. **Is It Thiccc? verdict** (engagement) — photo + "vote," reveal the official ruling next day. Repurposes the site's classifier as interactive social.
3. **Relatable riff** (shareability) — POV / "nobody:" / "tag someone who" on a real, encounterable object.
4. **Behind-the-desk** (follows) — the intern's office saga, rejected-submission bits, feuds.
5. **Spicy ranking / this-or-that** (replies) — "thicccer: the cement mixer or the Nimitz? settle it."

Roughly: 1 video/day, 1 static engagement post/day, 1–2 behind-the-desk or ranking posts/week.

## 30-day roadmap (PM-owned)

**Week 1 — unbreak + baseline.** Fix the image-poster `image:{url}` bug. Re-confirm all four post modes ship. Get the daily Reel posting native to TikTok reliably. Establish the intern persona in the bios.
**Week 2 — engagement formats.** Ship the "Is It Thiccc? vote/verdict" two-post loop and the POV/rate-it static templates (no link-out). Start a fixed weekly slot for a spicy ranking.
**Week 3 — series + face.** Launch the behind-the-desk intern bit as a recurring series. Add a "reader submission reviewed" slot (drives submissions + UGC).
**Week 4 — measure + double down.** Pull 30-day numbers (follower growth, saves, shares, video completion). Kill the lowest-performing pillar, double the best. Set the next milestone (target: first 1,000 followers on the best-performing platform).

## Metrics that matter (ignore likes)

- Follower growth rate per platform (the north star at this stage).
- Saves + shares per post (algorithmic fuel; saves especially).
- Video completion / average watch time on Reels/TikTok.
- Replies per post (the persona + ranking formats should drive these).
- *Not* likes, *not* clicks to site (we're explicitly not optimizing for site traffic right now).

## First milestones

1. Image poster fixed; all four modes confirmed shipping. (This week, the moment the shell is back.)
2. Native engagement formats live and posting daily.
3. 1,000 followers on the best-performing platform → revisit the merch test as a real signal.

See also: docs/SOCIAL-LAUNCH-BATCH.md (ready-to-post content you can publish by hand now).
