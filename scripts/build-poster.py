"""
Generate a high-resolution printable poster of any Thiccctionary entry.

v2 design (2026-05-03): tighter typography, decorative corner ornaments,
subtle paper texture, better margins. Closer to a Diderot encyclopedie plate.

Output: 18x24 inch portrait poster at 300 DPI = 5400x7200 px PNG.
Standard Printful poster size with bleed margin.

Usage:
  python3 scripts/build-poster.py --date 2026-05-03
  python3 scripts/build-poster.py --all
"""
import os, json, argparse, re, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'data', 'entries.json')
OUT_DIR = os.path.join(ROOT, 'posters')

CREAM = (244, 236, 220)
CREAM_DEEP = (235, 224, 200)
INK = (26, 20, 16)
INK_SOFT = (74, 61, 51)
OXBLOOD = (122, 31, 31)

W, H = 5400, 7200
M = 280

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

def draw_centered(draw, text, font, y, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2 - bbox[0], y), text, font=font, fill=fill)
    return y + (bbox[3] - bbox[1])

def add_paper_texture(img):
    """Subtle noise + warmth to mimic letterpress paper. Cheap effect."""
    random.seed(42)  # deterministic
    pixels = img.load()
    w, h = img.size
    # Sample 4% of pixels with tiny darkening for fiber-like texture
    sample_count = int(w * h * 0.04)
    for _ in range(sample_count):
        x = random.randint(0, w-1)
        y = random.randint(0, h-1)
        r, g, b = pixels[x, y]
        delta = random.randint(2, 8)
        pixels[x, y] = (max(0, r-delta), max(0, g-delta), max(0, b-delta))
    return img

def draw_corner_ornament(d, cx, cy, size=80, color=INK, rotate=0):
    """Draw a small fleuron/ornament at corner. Rotation in degrees: 0=topleft, 90=topright, 180=botright, 270=botleft."""
    # Simple 4-petal rosette
    s = size
    # Diamond + center dot composition
    if rotate == 0:    pts = [(cx, cy-s), (cx+s, cy), (cx, cy+s), (cx-s, cy)]
    else:              pts = [(cx, cy-s), (cx+s, cy), (cx, cy+s), (cx-s, cy)]
    d.polygon(pts, outline=color, width=4)
    d.ellipse([(cx-12, cy-12), (cx+12, cy+12)], fill=color)

def build_poster(entry):
    img = Image.new("RGB", (W, H), CREAM)
    img = add_paper_texture(img)
    d = ImageDraw.Draw(img)

    # Outer plate frame (heavier)
    d.rectangle([(M, M), (W - M, H - M)], outline=INK, width=8)
    # Inner hairline frame
    inset = 36
    d.rectangle([(M + inset, M + inset), (W - M - inset, H - M - inset)], outline=INK, width=2)

    # Corner ornaments (small diamond rosettes at frame corners)
    cx_left, cx_right = M + inset + 60, W - M - inset - 60
    cy_top, cy_bot = M + inset + 60, H - M - inset - 60
    draw_corner_ornament(d, cx_left, cy_top, size=40)
    draw_corner_ornament(d, cx_right, cy_top, size=40)
    draw_corner_ornament(d, cx_left, cy_bot, size=40)
    draw_corner_ornament(d, cx_right, cy_bot, size=40)

    # Top band: small kicker label with double-line decoration
    f_kicker = ImageFont.truetype(SERIF_ITAL, 72)
    kicker_y = M + inset + 130
    bbox = d.textbbox((0, 0), "THE  THICCCTIONARY", font=f_kicker)
    kw = bbox[2] - bbox[0]
    # decorative dashes around kicker
    dash_y = kicker_y + 30
    dash_len = 240
    dash_gap = 60
    d.line([((W - kw)//2 - dash_len - dash_gap, dash_y), ((W - kw)//2 - dash_gap, dash_y)], fill=OXBLOOD, width=4)
    d.line([((W + kw)//2 + dash_gap, dash_y), ((W + kw)//2 + dash_gap + dash_len, dash_y)], fill=OXBLOOD, width=4)
    draw_centered(d, "THE  THICCCTIONARY", f_kicker, kicker_y, OXBLOOD)

    # Headword
    f_word = ImageFont.truetype(SERIF_BOLD, 260)
    f_pos = ImageFont.truetype(SERIF_ITAL, 110)
    word_y = M + inset + 320
    headword_text = entry['word']
    bbox_w = d.textbbox((0, 0), headword_text, font=f_word)
    bbox_p = d.textbbox((0, 0), entry['partOfSpeech'], font=f_pos)
    ww = bbox_w[2] - bbox_w[0]
    pp = bbox_p[2] - bbox_p[0]
    gap = 50
    total = ww + gap + pp
    x_w = (W - total) // 2 - bbox_w[0]
    d.text((x_w, word_y - bbox_w[1]), headword_text, font=f_word, fill=INK)
    d.text((x_w + ww + gap - bbox_p[0], word_y + 70 - bbox_p[1]), entry['partOfSpeech'], font=f_pos, fill=INK_SOFT)

    # Pronunciation
    f_pron = ImageFont.truetype(SERIF_ITAL, 78)
    pron_y = word_y + 360
    draw_centered(d, entry['pronunciation'], f_pron, pron_y, INK_SOFT)

    # Hairline rule (decorated)
    rule_y = pron_y + 150
    d.line([(W*0.30, rule_y), (W*0.70, rule_y)], fill=INK, width=3)
    # Center dot ornament on the rule
    d.ellipse([(W//2 - 12, rule_y - 12), (W//2 + 12, rule_y + 12)], fill=INK)

    # Image with proper proportional borders
    photo = Image.open(os.path.join(ROOT, entry['image'])).convert("RGB")
    band_top = rule_y + 90
    band_bottom = H - M - inset - 1100
    band_h = band_bottom - band_top
    band_w = W - 2 * M - 2 * inset - 280

    ratio = min(band_w / photo.width, band_h / photo.height)
    new_w, new_h = int(photo.width * ratio), int(photo.height * ratio)
    photo = photo.resize((new_w, new_h), Image.LANCZOS)
    px = (W - new_w) // 2
    py = band_top + (band_h - new_h) // 2
    img.paste(photo, (px, py))

    # Photo border (double-line)
    d.rectangle([(px - 8, py - 8), (px + new_w + 8, py + new_h + 8)], outline=INK, width=4)
    d.rectangle([(px - 18, py - 18), (px + new_w + 18, py + new_h + 18)], outline=INK, width=2)

    # Photo caption (Plate N. style — italic, dictionary-illustration register)
    f_cap = ImageFont.truetype(SERIF_ITAL, 56)
    cap = strip_html(entry.get('caption', ''))
    cap_y = py + new_h + 60
    if cap:
        for line in wrap(d, cap, f_cap, W - 2 * M - 2 * inset - 600):
            cap_y = draw_centered(d, line, f_cap, cap_y, INK_SOFT) + 18

    # Definition (the strongest one)
    f_def = ImageFont.truetype(SERIF_BOLD, 80)
    def_text = strip_html(entry['definitions'][0])
    def_y = H - M - inset - 700
    for line in wrap(d, def_text, f_def, W - 2 * M - 2 * inset - 240):
        def_y = draw_centered(d, line, f_def, def_y, INK) + 24

    # Footer with double-line decoration
    foot_y = H - M - inset - 220
    dash_len = 200
    d.line([(W*0.30, foot_y), (W*0.30 + dash_len, foot_y)], fill=INK, width=2)
    d.line([(W*0.70 - dash_len, foot_y), (W*0.70, foot_y)], fill=INK, width=2)
    d.ellipse([(W//2 - 8, foot_y - 8), (W//2 + 8, foot_y + 8)], fill=INK)

    # URL
    f_url = ImageFont.truetype(SERIF_BOLD, 64)
    draw_centered(d, "thiccctionary.com", f_url, foot_y + 50, OXBLOOD)

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
    p.add_argument('--all', action='store_true', help='Build all 8 entries')
    args = p.parse_args()
    entries = json.load(open(ENTRIES))
    if args.date:
        e = next((x for x in entries if x['date'] == args.date), None)
        if not e:
            print(f"No entry for {args.date}"); return
        build_poster(e)
    elif args.all:
        for e in entries:
            build_poster(e)
    else:
        build_poster(entries[0])

if __name__ == '__main__':
    main()
