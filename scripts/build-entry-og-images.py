"""
Generate per-entry Open Graph cards (1200x630 JPEG).  Wave 312.

Why
---
Entry pages pointed og:image straight at the entry photograph. Those photos are
1080x1080 square, or taller. Every platform that renders a summary_large_image
card crops to 1.91:1, so a square photo loses 47% of its height -- top and
bottom -- with no say from us about which 47%. The most-shared pages on the site
have been showing a machine-chosen middle band of the subject.

This composes the crop deliberately instead: the photo fills a 1200x630 frame,
cover-cropped slightly above centre because the subject of a photograph of a
large object is almost never in the bottom third, with a scrim and the word set
over it in the site's own type. The photograph still carries the card -- that is
what makes people click -- it just stops being cropped by a stranger.

Idempotent: a card is rebuilt only when it is missing or older than its source
photo, so a full run after a daily entry costs one image, not 106.

Reads data/entries.json. Outputs to images/og/<date>.jpg.
Run: python3 scripts/build-entry-og-images.py [--force] [--date YYYY-MM-DD]
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json, os, sys, textwrap

CREAM = (244, 236, 220)
INK = (26, 20, 16)
OXBLOOD = (122, 31, 31)

W, H = 1200, 630
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_ITALIC = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'data', 'entries.json')
OUT_DIR = os.path.join(ROOT, 'images', 'og')


def cover_crop(img, w, h, focal_y=0.42):
    """Fill w x h, preserving aspect, biased toward focal_y of the source.

    0.42 rather than 0.5: in a photograph of a conspicuously large object the
    object sits at or above the middle, and the bottom of the frame is usually
    ground, water or road. Centre-cropping a square photo throws away the top
    of the subject first, which is the part that makes it worth looking at.
    """
    img = img.convert('RGB')
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    nw, nh = max(w, int(round(sw * scale))), max(h, int(round(sh * scale)))
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = int(round((nh - h) * focal_y))
    top = max(0, min(nh - h, top))
    return img.crop((left, top, left + w, top + h))


def scrim(size, height, strength=250, ramp=1.0, gamma=1.9):
    """A bottom-up ink gradient, so text over any photograph stays readable.

    The exponent matters more than the strength: a linear ramp reads as a grey
    bar laid over the picture, while a curved one looks like the photograph is
    simply darker at the bottom, which is what a real photograph often is.

    `ramp` is the fraction of `height` spent climbing; below that the gradient
    holds at full `strength`. The base scrim ramps the whole way (ramp=1.0), but
    a correction scrim needs to have already arrived by the time it reaches the
    type, or it spends its whole budget darkening the empty strip underneath it.
    """
    w, h = size
    grad = Image.new('L', (1, h), 0)
    px = grad.load()
    span = max(1.0, height * ramp)
    for y in range(h):
        t = (y - (h - height)) / span
        px[0, y] = 0 if t < 0 else int(strength * (min(1.0, t) ** gamma))
    return grad.resize((w, h))


def fit(text, font_path, max_width, start, floor):
    """Largest size at which text fits on one line, down to a floor."""
    size = start
    while size > floor:
        f = ImageFont.truetype(font_path, size)
        if f.getlength(text) <= max_width:
            return f
        size -= 2
    return ImageFont.truetype(font_path, floor)


def gloss_for(entry):
    """The small line under the rule: pronunciation, then part of speech.

    entries.json stores pronunciation both with and without surrounding slashes,
    so it gets normalised here rather than trusted.
    """
    pron = (entry.get('pronunciation') or '').strip().strip('/').strip()
    pos = (entry.get('partOfSpeech') or '').strip()
    bits = []
    if pron:
        bits.append(f'/{pron}/')
    if pos:
        bits.append(pos)
    line = '  '.join(bits)
    return line if len(line) <= 58 else (f'/{pron}/' if pron else pos)


def build_card(photo_path, word, gloss, out_path):
    base = cover_crop(Image.open(photo_path), W, H)

    # Scrim across the lower half, so the type below sits on ink, not on food.
    dark = Image.new('RGB', (W, H), INK)
    base = Image.composite(dark, base, scrim((W, H), 400))

    # A fixed scrim is a typed constant pretending to be a measurement: 65% ink
    # over a night shot is pitch black, and 65% ink over a white studio floor or
    # a bright fog sky is still bright enough that cream type on it is a squint.
    # So measure what the text band actually came out at and top it up only if
    # it needs it. The Bagger 288 card -- fog, pale road -- is what exposed this.
    # The 85th percentile, not the mean. On the Bagger 288 card the left half of
    # the band is a dark excavator and the right half is a pale motorway, and a
    # mean lets the dark half hide the bright half -- which is exactly where the
    # wordmark sits. A high percentile asks the question that matters: how bright
    # is the brightest patch any of this type has to survive?
    band = base.crop((0, H - 160, W, H)).convert('L')
    hist = band.histogram()
    cut = 0.85 * band.width * band.height
    run = 0
    for lum in range(256):
        run += hist[lum]
        if run >= cut:
            break
    TARGET = 45.0
    if lum > TARGET:
        # Alpha needed to pull the measured level down to TARGET over ink. Held
        # rather than ramped across the type, so the correction has arrived by
        # the time it reaches the words instead of peaking below them. Measured
        # across all 106 entries this takes the worst card from 4.0:1 to 7.7:1;
        # the watermelon and the hay bale, both shot on white, were the 4.0s.
        a = min(0.85, (lum - TARGET) / max(lum - INK[0], 1.0))
        base = Image.composite(dark, base,
                               scrim((W, H), 300, int(255 * a), 0.45, 1.4))

    d = ImageDraw.Draw(base)

    # Double rule: the dictionary-plate cue the rest of the site uses, drawn as
    # an ink line just outside a cream one. A single cream hairline vanished
    # entirely on the watermelon card, which is shot on white; a single ink one
    # would vanish on every night shot. Two lines cost nothing and one of them
    # is always visible whatever the photograph is doing behind it.
    m = 22
    d.rectangle([(m - 5, m - 5), (W - m + 4, H - m + 4)], outline=INK, width=2)
    d.rectangle([(m, m), (W - m - 1, H - m - 1)], outline=CREAM, width=2)

    pad = 64
    # Built from the bottom up and measured at every step, because the word font
    # changes size per entry and anything positioned by a guessed offset ends up
    # colliding with a descender on the one entry nobody looked at.

    # Gloss line: pronunciation and part of speech, the plate's small print.
    fg = ImageFont.truetype(MONO, 24)
    gloss_base = H - 78
    if gloss:
        d.text((pad, gloss_base), gloss, font=fg, fill=CREAM, anchor='ls')
        gloss_top = d.textbbox((pad, gloss_base), gloss, font=fg, anchor='ls')[1]
    else:
        gloss_top = gloss_base

    # Wordmark, right-aligned on the gloss line. It started in the top left and
    # was invisible on any photograph shot on white; down here it is always on
    # the scrim, which is the one part of the card whose brightness we control.
    fm = ImageFont.truetype(MONO, 20)
    d.text((W - pad, gloss_base), "THE THICCCTIONARY", font=fm, fill=CREAM,
           anchor='rs')

    # Oxblood rule, the same mark the entry pages put under a headword.
    rule_y = gloss_top - 22
    d.rectangle([(pad, rule_y - 4), (pad + 112, rule_y)], fill=OXBLOOD)

    # The word, as large as one line allows, sitting on the rule.
    fw = fit(word, SERIF_BOLD, W - pad * 2, 92, 40)
    d.text((pad, rule_y - 26), word, font=fw, fill=CREAM, anchor='ls')

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # JPEG, not PNG. These cards are photographs; the same card is 900 KB as a
    # PNG and 120 KB here, and 106 of them is the difference between a 13 MB
    # addition to the repo and a 95 MB one for no visible gain.
    base.save(out_path, 'JPEG', quality=82, optimize=True, progressive=True)


def main():
    force = '--force' in sys.argv
    only = None
    if '--date' in sys.argv:
        only = sys.argv[sys.argv.index('--date') + 1]

    entries = json.load(open(ENTRIES))
    built = skipped = missing = 0
    for e in entries:
        date = e.get('date')
        if not date or (only and date != only):
            continue
        rel = (e.get('image') or '').lstrip('./')
        src = os.path.join(ROOT, rel)
        if not rel or not os.path.exists(src):
            missing += 1
            continue
        out = os.path.join(OUT_DIR, f'{date}.jpg')
        if not force and os.path.exists(out) \
                and os.path.getmtime(out) >= os.path.getmtime(src):
            skipped += 1
            continue
        word = e.get('word') or date
        try:
            build_card(src, word, gloss_for(e), out)
            built += 1
        except Exception as ex:
            print(f'  {date}: could not build card ({ex})')
            missing += 1
    print(f'[entry-og] {built} card(s) built, {skipped} up to date, {missing} skipped.')


if __name__ == '__main__':
    main()
