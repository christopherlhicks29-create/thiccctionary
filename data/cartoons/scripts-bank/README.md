# Cartoon Scripts Bank

8 pre-written cartoon manifests covering 8 of the 13 running bits in `data/office-events.json`. Built Wave 198 (2026-05-23) so the Sunday 11:00 UTC cadence has ~2 months of inventory before launch.

## Status: SCRIPT BANKED, video clips TODO

Each manifest is a complete `compose-cartoon.py`-ready file EXCEPT the `video_url` fields, which contain a description of the clip needed instead of a real CloudFront URL. To use one:

1. Read the `video_url` description in each segment.
2. Generate the corresponding clip in Higgsfield using the staff member's existing portrait as the reference frame (same as Episode 0).
3. Replace the `video_url` value with the real CloudFront URL.
4. Move the manifest from `scripts-bank/` to `data/cartoons/`.
5. Fire `.fire-compose-cartoon` or run the compose workflow directly.

## Cadence

Recommended: one episode every Sunday at 11:00 UTC. At 8 banked + room to write more, that covers ~2 months of weekly drops without needing fresh ideas every week.

## Inventory

| # | ID | Bit | Characters | Approx duration |
|---|---|---|---|---|
| 1 | `ep01-bart-objections` | bart-objections | Bart | 32s |
| 2 | `ep02-margie-monaco` | margie-monaco | Margie | 36s |
| 3 | `ep03-spider-dispatches` | spider-dispatches | Spider | 38s |
| 4 | `ep04-office-coffee` | office-coffee | Eli, Bart | 36s |
| 5 | `ep05-saturn-v-feud` | saturn-v-feud | Bart, Teddy | 40s |
| 6 | `ep06-eli-hydrants` | eli-window | Eli | 34s |
| 7 | `ep07-girth-quarterly` | girth-quarterly | Bart | 36s |
| 8 | `ep08-spider-reginald` | spider-brother-in-law | Bart, Spider | 38s |

## Bits NOT covered (5 remaining)

For future episodes 9 onward:
- `spider-untraceable` (Macau phone number, Sheffield foundry expenses)
- `teddy-probation` (18 months in, Teddy unaware)
- `bertram-founder` (founding date keeps shifting)
- `junior-cataloguer-naming` (Bart's naming convention)
- `margie-vineyard` ("Whitmore Reserve" wine described as 'present')

## Brand voice notes (applied throughout)

- Documentary register, never wink at the joke
- Numbers said in full ("forty-seven" not "47")
- Lists of locations/items read as if they were expense codes
- Punchlines land via specificity (Swingline 747 stapler model, day 84 of broken coffee machine, three hundred twelve hydrants) , never via inflection
- Title cards bookend each skit; closing tag always includes thiccctionary.com
- All narrations use Hugh-voice (onyx model) for now; per-character voices possible later if Higgsfield clip matches

## Why these 8 first

These cover the running bits with the strongest visual potential AND the most stand-alone comedy. Test: imagine a viewer who has never seen the brand. Each of these skits should land as a 30-second deadpan office sitcom on its own. The catalog/dictionary frame is bonus context, not load-bearing.
