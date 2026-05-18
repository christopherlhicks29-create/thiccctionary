# Pre-Ship Checklist

Run `node scripts/pre-ship-check.js` before every commit. Add follow-on manual checks below depending on what changed.

## Automatic (the script runs these)

- [x] No em-dashes in source files (banned per Wave 114, reinforced 2026-05-17)
- [x] JSON files parse
- [x] JS files pass syntax check
- [x] YAML files parse
- [x] No HTML elements with both `hidden` attribute and inline `style="display: flex"` (PWA banner bug, Wave 156a)
- [x] No co-creation of a workflow file + its sentinel-trigger file in the same commit (Wave 160 trap)
- [x] styles.css change has a matching cache-buster bump in HTML

## Manual checks per change type

### CSS changes
- Visual diff before/after on the page that matters (look at it on phone if mobile-relevant)
- Cache-buster `?v=NN` bumped in HTML
- Tested in standalone PWA mode if banner / install-related

### JS generator changes
- Run the generator at least once with real APIs before claiming victory
- Check the OUTPUT, not just the exit code
- If a quality rater is involved, look at the rater's score distribution

### Workflow changes (.github/workflows/*.yml)
- After push, wait at least 60 seconds and check that the workflow ACTUALLY ran via the Actions tab
- If the workflow file is brand new, do NOT also include the sentinel that triggers it in the same commit (GitHub Actions doesn't reliably fire workflows on the push that creates them)
- For sentinel-triggered workflows, include diagnostic logging that COMMITS even on failure so debugging doesn't require the Actions UI

### Content changes (entries, articles, posts)
- Stranger-legibility test: imagine this is the first Thiccctionary thing someone has ever seen. Does it land?
- Names allowed as continuity, not as load-bearing references

### Admin changes
- Self-service end goal: every meaningful operation gets an admin button
- After firing a workflow from admin, verify the result actually deployed (not just "workflow dispatched")

### Bigger lifts (waves that change multiple files)
- After commit + push, manually visit the live URL of every affected page
- After Cloudflare deploys (~60s), check at least one phone reload
