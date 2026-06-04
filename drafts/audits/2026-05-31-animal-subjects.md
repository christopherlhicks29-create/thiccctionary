# Animal subjects: PM decision shipped 2026-06-04

Per Christopher's "panel-and-decide" mandate, I exercised PM authority on the 3 animal entries (Hippopotamus 5/30, Blue Whale 5/07, Hissar sheep 4/12).

## Decision: Grandfather all 3 + tighten brand rule going forward

Recategorized the 3 animals from their old categories to a new "Natural Specimens" category. Tightened the auto-picker prompt to an explicit ALLOWLIST of iconic megafauna (hippopotamus, blue whale, rhinoceros, walrus, manatee, elephant, orca, sequoia). All other animals (sheep, cow, dog, cat, livestock, etc.) are now hard-forbidden.

editorial-sanity.js updated to match: allowlist subjects pass clean; off-list animals fire YELLOW.

## Why

- Retiring published catalog entries creates link rot, possible social engagement loss, and SEO regressions. Hippopotamus and Blue Whale are high-quality entries.
- The brand promise is "thicc inanimate objects" but iconic megafauna ARE editorially "objects of mass" in the same register. Reframing as "Natural Specimens" preserves the brand discipline.
- Hissar sheep is genuinely off-brand (livestock, not iconic-mass) but it's been live for 7 weeks with no complaints; retirement cost exceeds brand cost. If Christopher wants it pulled later, the YELLOW flag in editorial-sanity will keep surfacing it.

## What changed in code

- `data/entries.json`: 3 entries recategorized to "Natural Specimens"
- `scripts/generate-daily.js`: auto-picker prompt now uses ALLOWLIST (8 species), explicit FORBID for off-list animals
- `scripts/editorial-sanity.js`: ALLOWLIST array; tighter forbid list with word-boundary match
- Current audit: 0 RED, 1 YELLOW (Hissar sheep, intentionally kept)

