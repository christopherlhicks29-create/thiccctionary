# Personal photos — Christopher's submissions

This folder holds photos Christopher has taken himself of thiccc things he encounters in his daily life.

## Why a separate folder

- **Rights-clean for print.** He owns these photos outright. No Unsplash license carve-outs to worry about when the book ships.
- **Personal touch.** A book where the editor took some of the photos himself reads more like a real reference work than a Pinterest scrape.
- **Higher priority for the book.** Personal photos are flagged `bookReady: true` candidates by default; only flagged false if the photo or subject doesn't hold up.

## How Christopher submits

Three paths, pick whichever is easiest:

1. **Drop photos in this folder directly.** Save to `D:\Thiccctionary.com\Thiccctionary.com\images\personal\` with a sensible filename (e.g., `2026-05-08-grandma-fridge.jpg`). Mention in the next Claude session that new submissions are here.

2. **Upload directly in chat.** Drag a photo into the Claude conversation and say "this is a thiccc submission." Claude saves it to this folder, drafts entry data, opens a PR for review.

3. **GitHub upload (optional, more technical).** Push a photo straight to this folder via git or the GitHub web UI. Daily cron's pipeline picks it up via a future watcher (TBD — Phase 2 work).

## What happens after a photo lands here

- Claude (in a session) writes the entry data: headword, definitions, etymology, example, caption, tags, category.
- Entry uses Christopher's name as the photographer credit (no Unsplash attribution — it's his photo).
- The entry goes into `data/entries.json` like a normal entry, but flagged `bookReady: null` (Christopher reviews) and with `source: "personal"` so we can filter for the photo essay.
- For the book, these become the "From the Editor's Camera" photo essay section.

## What makes a good personal-photo submission

- Real thiccc subject (not a person — the brand rule still holds).
- Roughly square or landscape composition (portraits work but get letterboxed in card layouts).
- Clear lighting, subject visible, foreground focus.
- A scene, not just a thing in isolation — the editorial register loves context (this fire hydrant on a sidewalk with snow piled around it; this concrete bench at the bus stop where everyone has decided not to sit).
- Quirky and specific is better than generic. A slightly weird local thing > a perfect studio shot of something common.

## What if the photo doesn't work as an entry

Sometimes a photo is interesting but isn't the kind of thing Thiccctionary catalogs. That's fine — it can still go in the photo essay. Or a future "Field Notes" section.

## Do not delete photos from this folder

Once submitted, photos stay here forever (so the book pipeline can find them later). If a photo gets used as an entry, the entry's `image` field points back here.
