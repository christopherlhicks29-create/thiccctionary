"""
Generate a high-resolution printable poster of any Thiccctionary entry.

Output: 18x24 inch portrait poster at 300 DPI = 5400x7200 px PNG.
This is the standard Printful poster size with full bleed margin.
The same file works for Etsy, Society6, Redbubble, etc.

Layout: dictionary-plate aesthetic — cream background, ink serif typography,
image as central plate with photographic credit + caption, brand-mark in foot.

Usage:
  python3 scripts/build-poster.py --date 2026-05-03
  python3 scripts/build-poster.py --all-strong   # builds the high-scoring entries
"""
import os, json, argparse, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'data', 'entries.json')
OUT_DIR = os.path.join(ROOT, 'posters')

CREAM = (244, 236, 220)
INK = (26, 20, 16)
INK_SOFT = (74, 61, 51)
OXBLOOD = (122, 31, 31)

# 18x24 poster at 300 DPI with 0.5 inch bleed margin
W, H = 5400, 7200
M = 240  # safe margin (~0.8 inch from edge)

SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_ITAL = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"

def strip_html(s): return re.sub(r'<[^>]+>', '', s or '').strip()

def wrap(draw, text, font, max_w):
    words = text.split()
    lines, current = [], ''
    for w in words:
        test = (current + ' ' + w).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_w:
            current = test
        else:
            if current: lines.append(current)
            current = w
    if current: lines.append(current)
    return lines

def draw_centered(draw, text, font, y, fill, max_w=None):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2 - bbox[0], y), text, font=font, fill=fill)
    return y + (bbox[3] - bbox[1])

def build_poster(entry):
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # Plate frame
    d.rectangle([(M, M), (W - M, H - M)], outline=INK, width=6)
    inset = 30
    d.rectangle([(M + inset, M + inset), (W - M - inset, H - M - inset)], outline=INK, width=2)

    # Top: small kicker label
    f_kicker = ImageFont.truetype(SERIF_ITAL, 80)
    draw_centered(d, "—  THE  THICCCTIONARY  —", f_kicker, M + inset + 80, OXBLOOD)

    # Headword + part of speech
    f_word = ImageFont.truetype(SERIF_BOLD, 280)
    f_pos = ImageFont.truetype(SERIF_ITAL, 130)
    word_y = M + inset + 240
    bbox_w = d.textbbox((0, 0), entry['word'], font=f_word)
    bbox_p = d.textbbox((0, 0), entry['partOfSpeech'], font=f_pos)
    ww = bbox_w[2] - bbox_w[0]
    pp = bbox_p[2] - bbox_p[0]
    gap = 60
    total = ww + gap + pp
    x_w = (W - total) // 2 - bbox_w[0]
    d.text((x_w, word_y - bbox_w[1]), entry['word'], font=f_word, fill=INK)
    d.text((x_w + ww + gap - bbox_p[0], word_y + 80 - bbox_p[1]), entry['partOfSpeech'], font=f_pos, fill=INK_SOFT)

    # Pronunciation
    f_pron = ImageFont.truetype(SERIF_ITAL, 90)
    pron_y = word_y + 380
    draw_centered(d, entry['pronunciation'], f_pron, pron_y, INK_SOFT)

    # Hairline rule
    rule_y = pron_y + 160
    d.line([(W*0.25, rule_y), (W*0.75, rule_y)], fill=INK, width=4)

    # Image — centered, fits in middle band
    photo = Image.open(os.path.join(ROOT, entry['image'])).convert("RGB")
    band_top = rule_y + 80
    band_bottom = H - M - inset - 1100  # leave room for definition + footer
    band_h = band_bottom - band_top
    band_w = W - 2 * M - 2 * inset - 200
    # Scale photo
    ratio = min(band_w / photo.width, band_h / photo.height)
    new_w, new_h = int(photo.width * ratio), int(photo.height * ratio)
    photo = photo.resize((new_w, new_h), Image.LANCZOS)
    px = (W - new_w) // 2
    py = band_top + (band_h - new_h) // 2
    img.paste(photo, (px, py))
    # Photo border
    d.rectangle([(px - 4, py - 4), (px + new_w + 4, py + new_h + 4)], outline=INK, width=2)

    # Caption (Plate N. style)
    f_cap = ImageFont.truetype(SERIF_ITAL, 64)
    cap = strip_html(entry.get('caption', ''))
    cap_y = py + new_h + 40
    if cap:
        for line in wrap(d, cap, f_cap, W - 2 * M - 2 * inset - 400):
            cap_y = draw_centered(d, line, f_cap, cap_y, INK_SOFT) + 20

    # Definition (the punchier one)
    f_def = ImageFont.truetype(SERIF_BOLD, 90)
    def_text = strip_html(entry['definitions'][0])
    def_y = H - M - inset - 760
    for line in wrap(d, def_text, f_def, W - 2 * M - 2 * inset - 200):
        def_y = draw_centered(d, line, f_def, def_y, INK) + 30

    # Footer rule
    foot_y = H - M - inset - 220
    d.line([(W*0.30, foot_y), (W*0.70, foot_y)], fill=INK, width=3)

    # URL
    f_url = ImageFont.truetype(SERIF_BOLD, 72)
    draw_centered(d, "thiccctionary.com", f_url, foot_y + 40, OXBLOOD)

    # Save
    os.makedirs(OUT_DIR, exist_ok=True)
    slug = re.sub(r'[^a-z0-9]+', '-', entry['word'].lower()).strip('-')
    out = os.path.join(OUT_DIR, f"{entry['date']}-{slug}.png")
    img.save(out, optimize=True)
    print(f"  Saved: {os.path.relpath(out, ROOT)}")
    return out

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--date', help='Single YYYY-MM-DD entry to build')
    p.add_argument('--all-strong', action='store_true', help='Build the high-quality archive entries')
    args = p.parse_args()
    entries = json.load(open(ENTRIES))
    if args.date:
        e = next((x for x in entries if x['date'] == args.date), None)
        if not e:
            print(f"No entry for {args.date}"); return
        build_poster(e)
    elif args.all_strong:
        # From the audit: skip Bulky Refrigerator (2026-05-02) and Heritage Tomato (2026-04-28)
        skip = {'2026-05-02', '2026-04-28'}
        for e in entries:
            if e['date'] in skip: continue
            build_poster(e)
    else:
        # Default: build today's
        build_poster(entries[0])

if __name__ == '__main__':
    main()
