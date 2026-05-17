#!/usr/bin/env python3
"""Overlay a New-Yorker-style caption beneath a cartoon image.

Usage: overlay-cartoon-caption.py <input.png> <output.png> <caption text>
"""
import sys
from PIL import Image, ImageDraw, ImageFont

def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current = []
    for w in words:
        trial = ' '.join(current + [w])
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(' '.join(current))
            current = [w]
        else:
            current.append(w)
    if current:
        lines.append(' '.join(current))
    return lines

def main():
    if len(sys.argv) < 4:
        print('Usage: overlay-cartoon-caption.py <input> <output> <caption>')
        sys.exit(1)
    input_path, output_path, caption = sys.argv[1], sys.argv[2], sys.argv[3]

    img = Image.open(input_path).convert('RGB')
    w, h = img.size

    # Try a serif font; fall back to default
    font_paths = [
        '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf',
    ]
    italic_paths = [
        '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf',
    ]
    font_size = max(28, w // 30)
    font = None
    for fp in font_paths:
        try:
            font = ImageFont.truetype(fp, font_size)
            break
        except (OSError, IOError):
            continue
    if font is None:
        font = ImageFont.load_default()

    italic_font = None
    for fp in italic_paths:
        try:
            italic_font = ImageFont.truetype(fp, font_size)
            break
        except (OSError, IOError):
            continue

    # Wrap caption to fit width with padding
    pad_x = max(40, w // 20)
    text_max = w - pad_x * 2
    tmp_draw = ImageDraw.Draw(img)
    lines = wrap_text(caption, font, text_max, tmp_draw)

    # Compute caption strip height
    line_height = int(font_size * 1.35)
    caption_pad_top = int(font_size * 1.0)
    caption_pad_bot = int(font_size * 1.2)
    strip_h = caption_pad_top + line_height * len(lines) + caption_pad_bot

    # Create new canvas with image + caption strip
    cream = (245, 232, 199)  # matches site cream
    canvas = Image.new('RGB', (w, h + strip_h), cream)
    canvas.paste(img, (0, 0))

    # Optional thin divider
    div = ImageDraw.Draw(canvas)
    div.line([(pad_x, h + caption_pad_top // 2), (w - pad_x, h + caption_pad_top // 2)], fill=(180, 165, 130), width=2)

    # Render lines centered
    draw = ImageDraw.Draw(canvas)
    y = h + caption_pad_top
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_w = bbox[2] - bbox[0]
        x = (w - line_w) // 2
        draw.text((x, y), line, font=font, fill=(40, 30, 20))
        y += line_height

    canvas.save(output_path, 'PNG', optimize=True)
    print(f'wrote {output_path} ({canvas.size})')

if __name__ == '__main__':
    main()
