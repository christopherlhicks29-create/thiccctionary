"""
Generate per-article Open Graph images (1200x630 PNG).
When an article is shared on social, its preview shows a unique card with
the article's title — instead of every article looking identical with the
generic og-default.png.

Reads data/articles.json. Outputs to articles/og/<slug>.png.

Run: python3 scripts/build-article-og-images.py
"""
from PIL import Image, ImageDraw, ImageFont
import json, os, textwrap, zlib

CREAM = (244, 236, 220)
CREAM_DEEP = (235, 224, 200)
INK = (26, 20, 16)
INK_SOFT = (74, 61, 51)
OXBLOOD = (122, 31, 31)

W, H = 1200, 630
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_ITALIC = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLES_PATH = os.path.join(ROOT, 'data', 'articles.json')
OUT_DIR = os.path.join(ROOT, 'articles', 'og')
os.makedirs(OUT_DIR, exist_ok=True)


def fit_title(text, draw, font_path, max_width, max_lines=3, start_size=84, min_size=46):
    """Wrap and shrink the title to fit within max_width × max_lines."""
    size = start_size
    while size >= min_size:
        font = ImageFont.truetype(font_path, size)
        # Try wrapping — find ideal width
        avg_char = font.getlength('M') * 0.6
        chars_per_line = max(int(max_width / avg_char), 8)
        lines = textwrap.wrap(text, width=chars_per_line)
        if len(lines) <= max_lines and all(font.getlength(l) <= max_width for l in lines):
            return font, lines
        size -= 6
    # Fallback: smallest size, may overflow
    font = ImageFont.truetype(font_path, min_size)
    avg_char = font.getlength('M') * 0.6
    chars_per_line = max(int(max_width / avg_char), 8)
    return font, textwrap.wrap(text, width=chars_per_line)[:max_lines]


def render_card(slug, title, description):
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # Subtle grain — performant version (~2000 pixels)
    # NOTE: use a stable hash (zlib.crc32), not the builtin hash(), which is
    # salted per-process (PYTHONHASHSEED) and was making every regen of an
    # unchanged slug produce a different noise pattern — pure git diff noise.
    import random
    random.seed(zlib.crc32(slug.encode()))
    for _ in range(2000):
        x = random.randint(0, W-1); y = random.randint(0, H-1)
        d.point((x, y), fill=(60, 30, 15, 4) if False else CREAM_DEEP)

    # Hairline border
    margin = 32
    d.rectangle([(margin, margin), (W-margin, H-margin)], outline=INK, width=2)

    # Eyebrow: small "AN ARTICLE — THICCCTIONARY"
    eyebrow_font = ImageFont.truetype(MONO, 22)
    eyebrow = "AN ARTICLE  ·  THICCCTIONARY"
    bbox = d.textbbox((0, 0), eyebrow, font=eyebrow_font)
    ew = bbox[2] - bbox[0]
    d.text(((W - ew) // 2, 80), eyebrow, font=eyebrow_font, fill=INK_SOFT)

    # Hairline rule under eyebrow
    rule_y = 130
    d.line([(W*0.30, rule_y), (W*0.70, rule_y)], fill=OXBLOOD, width=2)

    # Title — wrapped to fit
    title_max_w = W - 2 * (margin + 60)
    title_font, title_lines = fit_title(title, d, SERIF_BOLD, title_max_w, max_lines=3, start_size=84, min_size=48)
    line_h = title_font.size + 14
    total_title_h = len(title_lines) * line_h
    title_start_y = (H - total_title_h) // 2 - 20
    for i, line in enumerate(title_lines):
        bbox = d.textbbox((0, 0), line, font=title_font)
        lw = bbox[2] - bbox[0]
        d.text(((W - lw) // 2, title_start_y + i * line_h), line, font=title_font, fill=INK)

    # Description (italic, smaller, wrapped to 2 lines)
    desc_font = ImageFont.truetype(SERIF_ITALIC, 26)
    desc_max_w = W - 2 * (margin + 80)
    avg_char_w = desc_font.getlength('M') * 0.5
    chars_per_line = max(int(desc_max_w / avg_char_w), 30)
    desc_lines = textwrap.wrap(description, width=chars_per_line)[:2]
    desc_start_y = title_start_y + total_title_h + 24
    for i, line in enumerate(desc_lines):
        bbox = d.textbbox((0, 0), line, font=desc_font)
        lw = bbox[2] - bbox[0]
        d.text(((W - lw) // 2, desc_start_y + i * (desc_font.size + 8)), line, font=desc_font, fill=INK_SOFT)

    # URL footer
    url_font = ImageFont.truetype(SERIF_BOLD, 28)
    url = "thiccctionary.com"
    bbox = d.textbbox((0, 0), url, font=url_font)
    uw = bbox[2] - bbox[0]
    d.text(((W - uw) // 2, H - margin - 56), url, font=url_font, fill=OXBLOOD)

    out = os.path.join(OUT_DIR, f"{slug}.png")
    img.save(out, optimize=True)
    return out


def main():
    with open(ARTICLES_PATH, 'r', encoding='utf-8') as f:
        articles = json.load(f)
    for a in articles:
        # Strip HTML entities like &rsquo; from title for cleaner OG
        title = a['title'].replace('&rsquo;', "'").replace('&amp;', '&')
        desc = a.get('description', '')
        out = render_card(a['slug'], title, desc)
        size = os.path.getsize(out)
        print(f"  + {a['slug']}.png ({size//1024} KB) — {title}")
    print(f"\n{len(articles)} OG images generated in {OUT_DIR}")


if __name__ == '__main__':
    main()
