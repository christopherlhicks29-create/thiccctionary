# Catalog Audit — 2026-05-09

**Author:** Claude (autonomous PO mode)
**Scope:** All 12 entries currently in `data/entries.json`
**Purpose:** Honest read on which entries are working, which aren't, and why. Foundational input for the "product hardening" plan before distribution moves.

## Scoring rubric

Each entry rated on three 1-10 axes:

- **Register discipline** — Does it commit fully to mock-academic dictionary voice without breaking character into modern-internet speak?
- **Humor land** — Is it actually funny? Does the etymology deliver? Does definition #2 escalate satisfyingly? Is there a quotable line?
- **Image fit** — Does the subject naturally fit "thiccc"? Does the photo (via caption + subject) make sense for the entry?

Total /30. Verdict assigned per-entry.

## The scoreboard

| Entry | Register | Humor | Image | Total | Verdict |
|-------|----------|-------|-------|-------|---------|
| Concrete Mixer (4-27) | 10 | 9 | 10 | **29** | **CANONICAL** — keep |
| Ram 3500, Dually (4-29) | 9 | 8 | 9 | **26** | **CANONICAL** — keep |
| Thiccc Boeing (5-01) | 9 | 8 | 8 | **25** | KEEP — fix time-anchoring |
| Avocado, Domestic (4-30) | 9 | 9 | 7 | **25** | KEEP — watch body-adjacency |
| Frigidaire (5-02) | 9 | 7 | 7 | **23** | KEEP — minor edit |
| Sofa, Chesterfield (5-04) | 8 | 7 | 8 | **23** | KEEP |
| Watermelon, Moon and Stars (5-05) | 8 | 7 | 7 | **22** | KEEP |
| Pumpkin, Atlantic Giant (4-26) | 7 | 6 | 8 | **21** | KEEP — etymology punchline weak |
| Wheel, Parmigiano-Reggiano (5-06) | 7 | 6 | 8 | **21** | KEEP — tighten |
| Heritage Tomato (4-28) | 6 | 6 | 7 | **19** | **REGENERATE** — body-adjacent |
| Hoover Dam (5-08) | 6 | 5 | 7 | **18** | **REGENERATE** — register breaks |
| Banana, Cavendish (5-03) | 6 | 5 | 6 | **17** | **REGENERATE OR DROP** |

**Catalog floor (lowest total):** 17/30
**Catalog mean:** 22.4/30
**Catalog ceiling:** 29/30

## The strong pattern (entries scoring 25+)

What Concrete Mixer, Ram 3500, Avocado, and Boeing share:

1. **Etymology delivers real scholarship.** Concrete Mixer cites Latin `concretus` ("grown together"). Ram 3500 traces the brand from 1981 Dodge Ram. Avocado lands the Nahuatl `āhuacatl` etymology on "originally meaning testicle — which, frankly, tracks." Boeing self-references "First attested on Thiccctionary.com, May 2026." These read as actual reference work, not jokes pretending to be reference work.

2. **Deadpan delivery, never winking.** Concrete Mixer says "The drum's rotation is, for our purposes, decorative." That dismissal is funny *because* it's delivered straight, like a real dictionary editor noting an irrelevance. The strong entries never tell you it's funny.

3. **Definition #2 escalates with restraint.** Concrete Mixer: "*The platonic ideal of thicccness:* all body, no apologies." That's one short sentence that does more work than the weak entries' three-sentence flailing.

4. **Quotable lines.** Each strong entry has at least one line you'd screenshot:
   - "all body, no apologies"
   - "take up two spaces by birthright"
   - "which, frankly, tracks"
   - "The empennage on her? Architectural."

5. **Specific concrete imagery in the caption.** "At rest. Engine idle. Drum rotating." (Concrete Mixer). "Dually configuration, viewed from rear-quarter at sunset." (Ram 3500). Precision over flourish.

## The weak pattern (entries scoring <20)

What Hoover Dam, Banana Cavendish, and Heritage Tomato share:

1. **Etymology that doesn't deliver.** Hoover Dam invents a fake quote from engineers. Banana lands on a peel pun. Heritage Tomato calls them "vintage fashion models." None of these cite real scholarship, and the substitute jokes are weaker than scholarship would have been.

2. **Modern internet voice bleeding in.** "Like a boss" (Hoover Dam). "OG of thiccc infrastructure" (Hoover Dam). "Fruit hierarchy," "peel back expectations" (Banana). "Vintage fashion models" (Heritage Tomato). The dictionary register breaks every time the writer reaches for a familiar internet phrase instead of a scholarly one.

3. **Body-language slipping the editorial discipline.** Heritage Tomato uses "curves," "voluptuous form," "runway," "thin skins" → these are exactly the body-adjacent words the brand is supposed to be redirecting AWAY from. The whole point is "things, not people," but this entry sells the joke by leaning on people-language. Editorial integrity violation.

4. **Definition #2 flails.** Banana's def #2 is essentially def #1 restated with "any banana that commands attention with full-bodied presence." Adds nothing. Doesn't escalate.

5. **No quotable line.** Nothing in these three entries you'd screenshot. The whole entry blurs.

## Specific findings worth flagging

- **Time-anchoring leak:** "Thiccc Boeing" includes "esp. one parked tail-toward the camera at golden hour." We banned that pattern in wave 33 (NO TIME-ANCHORED FRAMING). This entry predates the wave but should be retroactively fixed.

- **Body-adjacency risk in Avocado:** "Pear-shaped fruit of disproportionate hip-to-waist ratio" pushes against the editorial line. The Nahuatl "testicle" etymology lands because it's about a fruit. The "hip-to-waist ratio" framing is closer to the line. Defensible but worth watching — if a journalist quotes it without context, it could read as having the body lens we claim to redirect.

- **The Wheel, Parmigiano-Reggiano** has "creamy behemoth of Italian craftsmanship" and "dairy divas" — both reading as ad copy more than dictionary register. Easy fix.

- **Pumpkin's etymology** does have real scholarship (Howard Dill, Nova Scotia, 1970s) but lands on "even pumpkins can dream big" — sentimental closer that breaks the deadpan. Replace.

## Recommendations (in order of leverage)

### Wave A2 (this session if time, next session if not):
**Regenerate three entries.** Hoover Dam, Banana Cavendish, Heritage Tomato. Each fails for distinct reasons but all fail. The new generations should run through the wave-30 humor critic and the new "what makes it funny" pattern doc (see Wave B).

### Wave A3:
**Light edits to four entries.** Boeing (strip "at golden hour"), Frigidaire (cut "double act of coolness and confidence"), Pumpkin (replace "even pumpkins can dream big" with a real-scholarship punchline), Parmigiano (cut "dairy divas," tighten "creamy behemoth"). These are 5-minute fixes, no regeneration needed.

### Wave A4:
**Flag bookReady on every entry.** Based on this audit:
- bookReady=true: Concrete Mixer, Ram 3500, Avocado, Boeing (after edit), Sofa Chesterfield, Frigidaire (after edit), Watermelon, Pumpkin (after edit), Parmigiano (after edit) — that's 9 entries
- bookReady=null (defer until regenerated): Hoover Dam, Banana, Heritage Tomato

### Wave B (next session):
**Distill the "what makes it funny" pattern into a prompt-engineering doc.** Codify the strong-pattern observations above into specific guidance baked into the entry-generation prompt. Right now the prompt says "be funny" implicitly. We can name the recipe: real-scholarship etymology, deadpan delivery, restraint in def #2, one quotable line, specific concrete caption.

### Wave C (next session):
**External calibration.** Christopher texts 5 friends/family the same 5 entries (mix of strong and weak), asks "which is funniest, no wrong answer." Their picks tell us if our scoring matches reality. Cost: 10 minutes of Christopher's time.

## What this audit doesn't do

- It can't tell us if a NEW reader laughs. Only continued use will.
- It can't see the actual photographs, only infer from captions. The image fit scores are partially reading-based.
- It can't predict which entries will get shared on social — that's a different axis (shareability ≠ audit quality, though usually correlated).

## Catalog health summary

We have 4 entries that are book-ready as-is, 5 that are book-ready after light edits, and 3 that drag the floor. After Wave A2/A3, the catalog floor lifts from 17/30 to ~22/30 and the mean from 22.4 to ~24.5. That's a real product improvement — the kind of thing that would make external readers say "this is consistently funny" instead of "some of these are funnier than others."

That's the gate I'd want to clear before any distribution moves.
