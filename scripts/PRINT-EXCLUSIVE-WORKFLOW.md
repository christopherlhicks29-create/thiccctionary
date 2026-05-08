# Print-exclusive content workflow

Book-only content lives in `data/print-exclusive.json`. Never published to the website. Captured continuously across the project; refined and edited during Phase 4 (Dec 2026 - Mar 2027) for the April 2027 launch.

## How to capture an idea

Three paths, pick whichever is easiest:

1. **In a Claude session.** Tell Claude "capture this print idea: [one-liner]." Claude appends a new item to `data/print-exclusive.json` with status `idea` and the timestamp. Five seconds.

2. **Edit the JSON directly.** Add a new object to the `items` array. Use one of the `_item_types` and one of the `_status_tags`. Commit when convenient.

3. **Voice memo / sticky note method.** Christopher captures the idea however (phone notes, voice memo, scrap paper). Next Claude session, he summarizes; Claude writes it into the JSON.

## Lifecycle

`idea` → captured but not drafted
`draft` → drafted but not finalized; Christopher hasn't reviewed
`ready` → final, can drop into book layout pipeline
`cut` → captured but later decided not to use

Items don't have to be linear; some `idea`s skip `draft` if Christopher writes them directly to `ready`. Items can be `cut` and then revived months later.

## Who writes what

- **Foreword, afterword, commentary tracks, origin notes, acknowledgments** → Christopher writes. AI shouldn't impersonate his personal voice.
- **Deep dives, alphabet entries, glossary, photo essay captions** → AI drafts, Christopher edits. Same workflow as the existing 10 articles.
- **Cut content section** → curated from existing catalog (filter `bookReady: false`); no new writing needed.

## When to refine

- **Phase 1-2 (now → September 2026):** capture only. Don't draft yet. The point is the IDEA pile.
- **Phase 3 (October-November 2026):** start drafting deep dives + alphabet entries. Foreword sketch.
- **Phase 4 (December 2026 - March 2027):** finalize everything. ~40-60 hours of editorial work.

## Schema (data/print-exclusive.json)

```json
{
  "_schema_version": "1",
  "_description": "...",
  "_item_types": { ... },
  "_status_tags": { ... },
  "items": [
    {
      "id": "kebab-case-id",
      "type": "foreword | afterword | deepdive | alphabet | commentary | photoessay | cutcontent | glossary | origin_note | acknowledgment | other",
      "status": "idea | draft | ready | cut",
      "title": "Human-readable title",
      "notes": "Why this exists, who's writing it, current state",
      "content": "Markdown content. Empty until drafted.",
      "created": "YYYY-MM-DD",
      "updated": "YYYY-MM-DD"
    }
  ]
}
```
