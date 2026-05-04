"""
Generate a high-resolution printable poster of any Thiccctionary entry.

v3 design (2026-05-04): tightened layout — image now dominates ~58% of canvas,
no dead space, better visual hierarchy. Standard Printful 18x24 inch poster
size at 300 DPI = 5400x7200 px PNG.
"""
import os, json, argparse, re, random
from PIL import Image, ImageDraw, ImageFont, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'data', 'entries.json')
OUT_DIR = os.path.join(ROOT, 'posters')

CREAM = (244, 236, 220)
INK = (26, 20, 16)
INK_SOFT = (74, 61, 51)
OXBLOOD = (122, 31, 31)

W, H = 5400, 7200
M = 240   # outer margin

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
    random.seed(42)
    pixels = img.load()
    w, h = img.size
    sample_count = int(w * h * 0.04)
    for _ in range(sample_count):
        x = random.randint(0, w-1)
        y = random.randint(0, h-1)
        r, g, b = pixels[x, y]
        delta = random.randint(2, 8)
        pixels[x, y] = (max(0, r-delta), max(0, g-delta), max(0, b-delta))
    return img

def draw_corner_ornament(d, cx, cy, size=40, color=INK):
    s = size
    pts = [(cx, cy-s), (cx+s, cy), (cx, cy+s), (cx-s, cy)]
    d.polygon(pts, outline=color, width=4)
    d.ellipse([(cx-12, cy-12), (cx+12, cy+12)], fill=color)

def build_poster(entry):
    img = Image.new("RGB", (W, H), CREAM)
    img = add_paper_texture(img)
    d = ImageDraw.Draw(img)

    # Frames
    d.rectangle([(M, M), (W - M, H - M)], outline=INK, width=8)
    inset = 32
    d.rectangle([(M + inset, M + inset), (W - M - inset, H - M - inset)], outline=INK, width=2)

    # Corner ornaments
    cx_left, cx_right = M + inset + 50, W - M - inset - 50
    cy_top, cy_bot = M + inset + 50, H - M - inset - 50
    for cx, cy in [(cx_left, cy_top), (cx_right, cy_top), (cx_left, cy_bot), (cx_right, cy_bot)]:
        draw_corner_ornament(d, cx, cy)

    # ---- TOP BAND (≈15% of height) ----
    # Kicker
    f_kicker = ImageFont.truetype(SERIF_ITAL, 56)
    kicker_y = M + inset + 90
    bbox = d.textbbox((0, 0), "THE  THICCCTIONARY", font=f_kicker)
    kw = bbox[2] - bbox[0]
    dash_y = kicker_y + 25
    dash_len = 200; dash_gap = 50
    d.line([((W - kw)//2 - dash_len - dash_gap, dash_y), ((W - kw)//2 - dash_gap, dash_y)], fill=OXBLOOD, width=4)
    d.line([((W + kw)//2 + dash_gap, dash_y), ((W + kw)//2 + dash_gap + dash_len, dash_y)], fill=OXBLOOD, width=4)
    draw_centered(d, "THE  THICCCTIONARY", f_kicker, kicker_y, OXBLOOD)

    # Headword (sized to fit)
    headword_text = entry['word']
    pos_text = entry['partOfSpeech']
    # Auto-shrink headword font if it would exceed available width
    max_word_width = W - 2*M - 2*inset - 400
    word_size = 220
    while word_size > 100:
        f_word = ImageFont.truetype(SERIF_BOLD, word_size)
        f_pos = ImageFont.truetype(SERIF_ITAL, int(word_size * 0.42))
        bbox_w = d.textbbox((0, 0), headword_text, font=f_word)
        bbox_p = d.textbbox((0, 0), pos_text, font=f_pos)
        ww = bbox_w[2] - bbox_w[0]
        pp = bbox_p[2] - bbox_p[0]
        if ww + 50 + pp <= max_word_width: break
        word_size -= 10
    word_y = kicker_y + 110
    gap = 50
    total = ww + gap + pp
    x_w = (W - total) // 2 - bbox_w[0]
    d.text((x_w, word_y - bbox_w[1]), headword_text, font=f_word, fill=INK)
    d.text((x_w + ww + gap - bbox_p[0], word_y + int(word_size*0.35) - bbox_p[1]), pos_text, font=f_pos, fill=INK_SOFT)

    # Pronunciation
    f_pron = ImageFont.truetype(SERIF_ITAL, 70)
    pron_y = word_y + word_size + 60
    draw_centered(d, entry['pronunciation'], f_pron, pron_y, INK_SOFT)

    # Hairline rule with center dot
    rule_y = pron_y + 130
    d.line([(W*0.32, rule_y), (W*0.68, rule_y)], fill=INK, width=3)
    d.ellipse([(W//2 - 11, rule_y - 11), (W//2 + 11, rule_y + 11)], fill=INK)

    # ---- IMAGE (≈58% of height — the dominant element) ----
    photo = Image.open(os.path.join(ROOT, entry['image'])).convert("RGB")
    image_top = rule_y + 80
    # Reserve bottom for caption + definition + footer (~1100 px)
    image_bottom = H - M - inset - 950
    band_h = image_bottom - image_top
    band_w = W - 2 * M - 2 * inset - 200
    ratio = min(band_w / photo.width, band_h / photo.height)
    new_w, new_h = int(photo.width * ratio), int(photo.height * ratio)
    photo = photo.resize((new_w, new_h), Image.LANCZOS)
    px = (W - new_w) // 2
    py = image_top + (band_h - new_h) // 2
    img.paste(photo, (px, py))
    # Double-line border
    d.rectangle([(px - 8, py - 8), (px + new_w + 8, py + new_h + 8)], outline=INK, width=4)
    d.rectangle([(px - 18, py - 18), (px + new_w + 18, py + new_h + 18)], outline=INK, width=2)

    # ---- BOTTOM BAND (caption + definition + footer, no dead space) ----
    f_cap = ImageFont.truetype(SERIF_ITAL, 50)
    cap = strip_html(entry.get('caption', ''))
    y = py + new_h + 50
    if cap:
        for line in wrap(d, cap, f_cap, W - 2 * M - 2 * inset - 400):
            y = draw_centered(d, line, f_cap, y, INK_SOFT) + 15

    # Definition — no gap, just sits below caption with a tiny rule
    f_def = ImageFont.truetype(SERIF_BOLD, 72)
    def_text = strip_html(entry['definitions'][0])
    y += 30
    # short decorative rule
    d.line([(W*0.40, y), (W*0.60, y)], fill=INK, width=2)
    y += 50
    for line in wrap(d, def_text, f_def, W - 2 * M - 2 * inset - 200):
        y = draw_centered(d, line, f_def, y, INK) + 22

    # Footer — sits near bottom
    foot_y = H - M - inset - 130
    dash_len = 180
    d.line([(W*0.32, foot_y), (W*0.32 + dash_len, foot_y)], fill=INK, width=2)
    d.line([(W*0.68 - dash_len, foot_y), (W*0.68, foot_y)], fill=INK, width=2)
    d.ellipse([(W//2 - 7, foot_y - 7), (W//2 + 7, foot_y + 7)], fill=INK)
    f_url = ImageFont.truetype(SERIF_BOLD, 60)
    draw_centered(d, "thiccctionary.com", f_url, foot_y + 40, OXBLOOD)

    os.makedirs(OUT_DIR, exist_ok=True)
    slug = re.sub(r'[^a-z0-9]+', '-', entry['word'].lower()).strip('-')
    out = os.path.join(OUT_DIR, f"{entry['date']}-{slug}.png")
    img.save(out, optimize=True)
    print(f"  Saved: {os.path.relpath(out, ROOT)}")
    return out

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--date', help='Single YYYY-MM-DD entry to build')
    p.add_argument('--all', action='store_true', help='Build all entries')
    args = p.parse_args()
    entries = json.load(open(ENTRIES))
    if args.date:
        e = next((x for x in entries if x['date'] == args.date), None)
        if not e: print(f"No entry for {args.date}"); return
        build_poster(e)
    elif args.all:
        for e in entries:
            build_poster(e)
    else:
        build_poster(entries[0])

if __name__ == '__main__':
    main()
