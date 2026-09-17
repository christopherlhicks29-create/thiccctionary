# Last image-regen run

Written by scripts/regenerate-images.js and committed by the workflow with
`if: always()`, so it exists even when the run exits non-zero and opens no PR.

- **Run:** [35256595613](https://github.com/christopherlhicks29-create/thiccctionary/actions/runs/35256595613)
- **Dates requested:** `2026-09-03,2026-09-09,2026-08-21,2026-09-08,2026-09-13`
- **Subject override:** `(none)`
- **Result:** 1 critic-rejected, 1 error, 3 replaced

| Date | Word | Outcome | Detail |
| --- | --- | --- | --- |
| 2026-09-13 | Wrecking Ball, Demolition | **critic-rejected** | 30 candidates, 5 attempts, last verdict: score=1, subject%=24, NOT THE SUBJECT, saw "a construction site with excavators", stranger sees "construction site with excavators" |
| 2026-09-09 | Big Top, Circus Tent | **error** | Vision pick failed: 400 {   "error": {     "message": "Unable to download content from the provided URL before the timeout. Check that the URL is publicly accessible and responds promptly, or upload the file and provide a file_id instead.",     "type": "invalid_request_error",     "param": null,     |
| 2026-09-08 | Clock, Grandfather | **replaced** | images/2026-09-08-clock-grandfather-btnc.jpg <- https://unsplash.com/photos/a-grandfather-clock-sitting-on-top-of-a-table-rPilGSMEO3k (score=8, subject%=48, saw "a real antique wooden grandfather clock", stranger sees "an antique grandfather clock"), recaptioned "Plate CXLVI., Antique wooden grandfa |
| 2026-09-03 | Cruise Ship, Ocean Liner | **replaced** | images/2026-09-03-cruise-ship-ocean-liner-c0te.jpg <- https://unsplash.com/photos/white-and-black-cruise-ship-on-sea-during-daytime-gXVgI-zaHys (no critique (critic unavailable)), recaptioned "Plate CXLI., Yacht sailing in front of the cruise liner Queen Victoria, moored off Bournemouth during the p |
| 2026-08-21 | Anchor, Ship's | **replaced** | images/2026-08-21-anchor-ship-s-c7yd.jpg <- https://unsplash.com/photos/a-rusty-anchor-on-a-beach-with-a-mountain-in-the-background-iupXZ62DQBY (score=9, subject%=35, saw "a real rusty ship's anchor on a beach", stranger sees "a rusty anchor on a beach"), recaptioned "Plate CXXX., Rusty ship's ancho |
