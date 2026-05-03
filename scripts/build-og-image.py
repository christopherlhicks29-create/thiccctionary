"""
Generate the homepage Open Graph image (1200x630) — what previews when the site URL is shared
on Twitter / Slack / iMessage / Discord. Single brand-mark on cream background, dictionary-plate aesthetic.

Saves to: assets/og-default.png

Run: python3 scripts/build-og-image.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

CREAM = (244, 236, 220)
INK = (26, 20, 16)
OXBLOOD = (122, 31, 31)

W, H = 1200, 630
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_ITALIC = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf"

img = Image.new("RGB", (W, H), CREAM)
d = ImageDraw.Draw(img)

# Hairline border (subtle dictionary-plate frame)
m = 40
d.rectangle([(m, m), (W-m, H-m)], outline=INK, width=2)

# Title — large
font_title = ImageFont.truetype(SERIF_BOLD, 92)
title = "The Thiccctionary"
bbox = d.textbbox((0, 0), title, font=font_title)
tw = bbox[2] - bbox[0]
d.text(((W - tw) // 2 - bbox[0], 200), title, font=font_title, fill=INK)

# Hairline rule
rule_y = 320
d.line([(W*0.20, rule_y), (W*0.80, rule_y)], fill=INK, width=2)

# Subtitle
font_sub = ImageFont.truetype(SERIF_ITALIC, 44)
sub = "A daily reference for thick objects."
bbox = d.textbbox((0, 0), sub, font=font_sub)
sw = bbox[2] - bbox[0]
d.text(((W - sw) // 2 - bbox[0], 360), sub, font=font_sub, fill=INK)

# URL footer
font_url = ImageFont.truetype(SERIF_BOLD, 32)
url = "thiccctionary.com"
bbox = d.textbbox((0, 0), url, font=font_url)
uw = bbox[2] - bbox[0]
d.text(((W - uw) // 2 - bbox[0], 510), url, font=font_url, fill=OXBLOOD)

# Output
# saved at repo root
out = "og-default.png"
img.save(out, optimize=True)
print(f"Saved {out} ({W}x{H})")
