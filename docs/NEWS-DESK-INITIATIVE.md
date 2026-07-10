# The Thiccc Beat — current-events desk (engagement engine)

Vision (Christopher, 2026-06-08): "More regular articles by the different employees using their personalities and even taking in current news, sort of like Barstool. I'd like to get more reader engagement." Social tie-in expected. PM (Claude) owns the how.

## Thesis
Barstool-style engagement = (1) distinct personalities readers follow and defend, (2) topicality — reacting to NOW, (3) cadence/volume. Thiccctionary already has the personalities (canon cast) and the lens (deadpan institutional reverence for thiccc things). Missing: topicality, a tighter social loop, and readers being able to "follow" one specific employee. This initiative adds those.

## Format: "The Thiccc Beat" (working name)
A recurring short column where a cast member reacts — in voice — to a current thiccc-relevant news story. 200-500 words. Frequent (target 3x/week, ramp from 1x). Each ends with a RULING ("Thiccc. / Not thiccc. / Ranks 3rd all-time.") so it's interactive and comment-baiting. This reuses the proven recurring-column pattern already live in "Filed Replies" (Bart mailbag) and "From the Boat" (Bertram) — the infra exists; we're widening it to the whole cast + making it topical.

## The aperture (key design decision — DEFAULTED, Christopher can veto)
"Thiccc news" = any current story where mass, size, heft, or abundance is the point.
- IN scope: largest-ever ship/aircraft/building, record giant produce, Fat Bear Week, viral chonky animals, megaprojects (dams, bridges, rockets), absurdly large new products, "absolute unit" culture moments.
- OUT of scope (hard rules): human bodies (the inviolable brand rule — never), partisan politics, anything where size isn't the joke.
- Default posture: generous but disciplined. If size/heft is the story and it's not a person, the desk covers it. Generous enough for a steady stream; disciplined enough to not dilute the brand. (This is the one call worth a CEO gut-check since it touches brand identity.)

## Voice lanes (so readers get a favorite to follow)
Each cast member owns a beat so they read DISTINCT, not just "deadpan x8":
- **Bertram Whitmore** (Publisher, from the Margaret IV): grand pronouncements; maritime + megastructure news; the long view.
- **Bartholomew "Bart"** (Senior Cataloguer): the rulings and objections; pedantic "well, actually" verdicts. The guy people argue with.
- **Hugh Drumm** (Field Correspondent): industrial/machinery/foundry news; weathered dispatches from the field.
- **Eliza / Constance / Teddy / Margie**: assign lanes — food & agriculture records, architecture, vehicles, megafauna — one each.
- **Spider Hennessy** (nom de plume): the wildcard hot-take voice; the unhinged ranking.
- **Jon** (Circulation Manager): working animals, endurance events, anything that carries weight for a living. One sentence longer than his usual output, and only when the story is squarely in the lane; Jon does not reach.

## Engine (how it runs)
1. **Sourcing**: scheduled web-search scan for thiccc-relevant current stories; surface 3-5 candidates each cycle with a relevance + comedy score.
2. **Routing**: assign each story to the cast member whose lane fits.
3. **Generation**: new `generate-thiccc-beat.js` mirroring `generate-from-the-boat.js`; reuse the humor gate + the canon-link auto-linker + the mobile-nav/footer scaffolding.
4. **Publish**: column page + a homepage "The Thiccc Beat" rail + RSS.
5. **Social loop (the engagement multiplier)**: every column auto-clips to social as BOTH a quote card (static) AND a short deadpan-voice reel reading the take. Topical takes are the single most shareable thing we can make, and they pull non-followers back.

## Why it drives engagement
- Topicality gives a reason to check NOW (vs. an evergreen catalog).
- Personalities give someone to follow + a favorite to defend (the Barstool effect).
- The "ruling" format invites comments/votes (agree/disagree, is it thiccc?).
- Social clips of hot takes are inherently shareable → reach → back to site.

## Build order
1. (now, no code env) This spec + lock voice-lane assignments.
2. `generate-thiccc-beat.js` + a news-sourcing step (needs the sandbox/web search).
3. Cadence cron + homepage "Thiccc Beat" rail + RSS wiring.
4. Social auto-clip per column (quote card + reel) — ties into the video/reach engine.
5. Comment/vote affordance on columns to capture the engagement signal.

## Honest risks / guardrails
- **Forced topicality**: if there's no good thiccc story that cycle, SKIP — don't reach. Quality bar (never ship B-minus) holds.
- **Voice sameness**: lanes must read genuinely different (Bart pedantic, Hugh weathered, Spider unhinged), or it's just one voice eight times.
- **Sequencing**: this is a build investment that pays off once there's an audience. It's worth running in parallel with the video/reach push because the columns FEED the video engine (every take is a reel script).

## Dependency
Most of the build needs the code environment (sandbox shell) back. Spec + lane lock can happen now. Folded into the daily auto-resume task so it progresses automatically.
