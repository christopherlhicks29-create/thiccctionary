# Personal photos folder

Drop photos here that Christopher captured himself. Filename format suggestion:
`YYYY-MM-DD-subject-slug.jpg` (e.g., `2026-05-09-cement-mixer-suburb.jpg`).

Then tell Claude about it in chat, Claude will:
1. Run the standard image audit (size, alt text, brand fit)
2. Create the entry text via the daily-generation prompt with SUBJECT_OVERRIDE
3. Wire it into entries.json + sitemap + RSS

This folder skips the public submit-a-thiccc form entirely.
