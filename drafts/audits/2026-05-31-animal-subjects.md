# Audit notice: 3 animal entries violate the inanimate-objects brand rule

Per `scripts/generate-daily.js` auto-picker prompt: "THICK INANIMATE OBJECTS (never people, never bodies, never animals)."

Three published entries violate this rule:

| Date | Subject | Category |
|---|---|---|
| 2026-05-30 | Hippopotamus, Common | Engineering Marvels |
| 2026-05-07 | Whale, Blue | Engineering Marvels |
| 2026-04-12 | Hissar sheep | Produce & Botanical |

## Why I am not pulling them

Catalog entry retirement is on the CEO-list per `feedback_the_guy` memory (irreversible deletions). These are published, indexed, possibly shared on socials. Pulling them is your call, not mine.

## What I have done

1. Hardened the auto-picker prompt to explicitly prohibit animals and list common offenders by name (hippopotamus, whale, sheep, cow, pig, bear, etc.). Future cron runs should not produce another animal subject.
2. Added animal-subject check to `scripts/editorial-sanity.js` so any new animal entry will fire a YELLOW flag in the pre-ship gate.

## Decision needed

Three options:

- **A. Retire all 3.** Pull from data/entries.json + HTML + feeds + sitemap. Replace each date with a real inanimate subject via batch-entries. Most brand-pure.
- **B. Grandfather all 3.** Treat as historical exceptions, remove the brand rule prohibiting animals, soften prompt to "thick subjects." Easiest, but the brand promise shifts.
- **C. Hybrid: keep some, retire others.** Hippopotamus and Blue Whale are recent and high-quality; Hissar sheep was an early entry, unclear if it lands.

I am leaning toward C: keep Hippopotamus and Blue Whale as "Engineering Marvels of Mass" exceptions (they read like satire of biological scale), retire Hissar sheep. But this is your editorial call.

