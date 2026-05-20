"""
Wave 191: Cartoon series composer.

Takes a cartoon manifest (data/cartoons/<id>.json) and produces a single
vertical 9:16 MP4 by:
  1. Downloading each video clip from its CloudFront URL (or each photo)
  2. Generating per-segment narration audio via OpenAI TTS (onyx voice)
  3. Building title cards as PNG -> short MP4
  4. Building photo montage with Ken-Burns motion
  5. Stitching everything with ffmpeg concat demuxer
  6. Writing videos/cartoons/<id>.mp4

Designed for GitHub Actions runner (full network, ffmpeg + Python preinstalled).

Usage:
  python3 scripts/compose-cartoon.py data/cartoons/ep00-welcome.json
  python3 scripts/compose-cartoon.py data/cartoons/ep00-welcome.json --horizontal
"""

import json
import os
import sys
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Brand colors (match the editorial broadsheet aesthetic)
CREAM = (244, 236, 220)
CREAM_DEEP = (235, 224, 200)
INK = (26, 20, 16)
INK_SOFT = (74, 61, 51)
OXBLOOD = (122, 31, 31)

# Vertical 9:16 dimensions (matches Seedance output)
W, H = 720, 1280

# Font paths (Ubuntu runner)
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "videos" / "cartoons"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch(url: str, dest: Path) -> Path:
    """Download a URL to dest. Idempotent."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"  fetch: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "thiccctionary-cartoon-composer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())
    return dest


def run_ffmpeg(args: list, label: str = ""):
    """Run ffmpeg with error capture."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args
    if label:
        print(f"  ffmpeg [{label}]: {' '.join(args[:3])}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("FFMPEG STDERR:", result.stderr)
        raise RuntimeError(f"ffmpeg failed: {label}")
    return result


def get_duration(media_path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(media_path),
    ], capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def tts_segment(text: str, voice: str, model: str, speed: float, dest: Path) -> Path:
    """Generate TTS audio via OpenAI."""
    if not text or not text.strip():
        # Silent track for title cards with no narration. dest is .mp3 so encode
        # with libmp3lame, not aac (aac in mp3 container = ffmpeg error).
        run_ffmpeg([
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t", "1", "-c:a", "libmp3lame", "-b:a", "128k", str(dest),
        ], "silent")
        return dest
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    print(f"  tts: '{text[:60]}{'...' if len(text)>60 else ''}'")
    payload = json.dumps({
        "model": model,
        "voice": voice,
        "input": text,
        "speed": speed,
        "response_format": "mp3",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())
    return dest


def make_title_card(text: str, dest: Path, duration: float):
    """Render a brand title card as PNG then encode to MP4."""
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # Top + bottom decorative rule
    d.rectangle([(60, 80), (W - 60, 84)], fill=OXBLOOD)
    d.rectangle([(60, H - 84), (W - 60, H - 80)], fill=OXBLOOD)

    # Vertical rules on edges
    d.rectangle([(40, 60), (44, H - 60)], fill=INK)
    d.rectangle([(W - 44, 60), (W - 40, H - 60)], fill=INK)

    # Small "THICCCTIONARY" header
    try:
        small = ImageFont.truetype(MONO_BOLD, 24)
    except OSError:
        small = ImageFont.load_default()
    header = "THICCCTIONARY"
    bbox = d.textbbox((0, 0), header, font=small)
    th_w = bbox[2] - bbox[0]
    d.text(((W - th_w) // 2, 130), header, fill=OXBLOOD, font=small)
    d.text(((W - th_w) // 2 + 1, 130), header, fill=OXBLOOD, font=small)  # bold sim

    # Main text — wrap and size to fit
    lines = text.split("\n")
    # Try sizes from large to small until everything fits in a centered box
    for size in (96, 88, 80, 72, 64, 56, 48, 40):
        try:
            font = ImageFont.truetype(SERIF_BOLD, size)
        except OSError:
            font = ImageFont.load_default()
        line_h = int(size * 1.2)
        total_h = line_h * len(lines)
        widths = [d.textlength(l, font=font) for l in lines]
        if max(widths) <= W - 120 and total_h <= H - 400:
            break

    start_y = (H - total_h) // 2
    for i, line in enumerate(lines):
        lw = d.textlength(line, font=font)
        d.text(((W - lw) // 2, start_y + i * line_h), line, fill=INK, font=font)

    png_path = dest.with_suffix(".png")
    img.save(png_path)

    # Encode PNG to MP4 of `duration` seconds at 30fps
    run_ffmpeg([
        "-loop", "1", "-i", str(png_path),
        "-c:v", "libx264", "-t", str(duration), "-pix_fmt", "yuv420p",
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30",
        str(dest),
    ], f"titlecard {dest.name}")


def make_photo_montage(image_urls: list, dest: Path, duration: float, tmp: Path):
    """Build a Ken-Burns-style photo montage from URLs into an MP4."""
    n = len(image_urls)
    per = duration / n

    segments = []
    for i, url in enumerate(image_urls):
        img_path = tmp / f"montage_src_{i}.jpg"
        try:
            fetch(url, img_path)
        except Exception as e:
            print(f"  warn: skipping {url}: {e}")
            continue

        # Resize + crop to 9:16 with Ken-Burns zoom over the duration
        seg_out = tmp / f"montage_seg_{i}.mp4"
        # zoompan: subtle zoom in over per-segment duration
        frames = int(per * 30)
        zoom_filter = (
            f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,"
            f"crop={W*2}:{H*2},"
            f"zoompan=z='min(zoom+0.0012,1.18)':d={frames}:s={W}x{H}:fps=30"
        )
        run_ffmpeg([
            "-loop", "1", "-i", str(img_path),
            "-c:v", "libx264", "-t", str(per), "-pix_fmt", "yuv420p",
            "-vf", zoom_filter,
            str(seg_out),
        ], f"montage seg {i}")
        segments.append(seg_out)

    if not segments:
        # Fallback: solid cream card
        make_title_card("(montage unavailable)", dest, duration)
        return

    # Concat segments
    concat_list = tmp / "montage_concat.txt"
    concat_list.write_text("".join(f"file '{s.resolve()}'\n" for s in segments))
    run_ffmpeg([
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dest),
    ], "montage concat")


LEAD_SILENCE = 0.35   # silence before narration starts (visual settles)
TAIL_SILENCE = 0.45   # silence after narration ends (room to breathe)


def fit_video_to_segment(src: Path, audio: Path, min_duration: float, dest: Path):
    """Audio-driven mux: segment duration = max(min_duration, audio + lead + tail).
    Visual stretches to fit by holding the last frame; audio gets leading silence
    so character mouth has time to start before narration begins."""
    audio_dur = get_duration(audio)
    src_dur = get_duration(src)
    final_dur = max(min_duration, LEAD_SILENCE + audio_dur + TAIL_SILENCE)
    print(f"  timing: audio={audio_dur:.2f}s, src={src_dur:.2f}s, min={min_duration}s -> final={final_dur:.2f}s")

    # Normalize video to 720x1280 30fps. If source is shorter than final, hold the
    # last frame to extend. tpad=stop_mode=clone clones the final frame.
    normalized = src.with_suffix(".norm.mp4")
    extra = max(0.0, final_dur - src_dur)
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30"
    if extra > 0.05:
        vf += f",tpad=stop_mode=clone:stop_duration={extra:.3f}"
    run_ffmpeg([
        "-i", str(src),
        "-vf", vf,
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-t", f"{final_dur:.3f}",
        str(normalized),
    ], f"normalize {src.name}")

    # Audio: prepend LEAD_SILENCE seconds of silence, then narration, then pad to final_dur.
    padded_audio = src.with_suffix(".audio.aac")
    run_ffmpeg([
        "-f", "lavfi", "-t", f"{LEAD_SILENCE:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-i", str(audio),
        "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[concat];[concat]apad[padded]",
        "-map", "[padded]",
        "-t", f"{final_dur:.3f}",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        str(padded_audio),
    ], f"audio lead+pad {audio.name}")

    # Mux normalized video with padded audio.
    run_ffmpeg([
        "-i", str(normalized), "-i", str(padded_audio),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(dest),
    ], f"mux {dest.name}")


def encode_segment_with_audio(silent_video: Path, audio: Path, min_duration: float, dest: Path):
    """Audio-driven mux for title cards / photo montages. Visual extends by
    holding last frame; audio gets leading silence to match the rest."""
    audio_dur = get_duration(audio)
    src_dur = get_duration(silent_video)
    final_dur = max(min_duration, LEAD_SILENCE + audio_dur + TAIL_SILENCE)
    print(f"  timing: audio={audio_dur:.2f}s, src={src_dur:.2f}s, min={min_duration}s -> final={final_dur:.2f}s")

    # Re-encode visual with held last frame if shorter than final.
    normalized = silent_video.with_suffix(".norm.mp4")
    extra = max(0.0, final_dur - src_dur)
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30"
    if extra > 0.05:
        vf += f",tpad=stop_mode=clone:stop_duration={extra:.3f}"
    run_ffmpeg([
        "-i", str(silent_video),
        "-vf", vf,
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-t", f"{final_dur:.3f}",
        str(normalized),
    ], f"normalize {silent_video.name}")

    padded_audio = silent_video.with_suffix(".audio.aac")
    run_ffmpeg([
        "-f", "lavfi", "-t", f"{LEAD_SILENCE:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-i", str(audio),
        "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[concat];[concat]apad[padded]",
        "-map", "[padded]",
        "-t", f"{final_dur:.3f}",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        str(padded_audio),
    ], f"audio lead+pad {audio.name}")

    run_ffmpeg([
        "-i", str(normalized), "-i", str(padded_audio),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(dest),
    ], f"mux {dest.name}")


def compose(manifest_path: Path) -> Path:
    manifest = json.loads(manifest_path.read_text())
    ep_id = manifest["id"]
    vo = manifest.get("voiceover", {})
    voice = vo.get("voice", "onyx")
    tts_model = vo.get("model", "tts-1")
    speed = float(vo.get("speed", 1.0))

    with tempfile.TemporaryDirectory(prefix=f"compose-{ep_id}-") as tmp_str:
        tmp = Path(tmp_str)
        segment_files = []

        for i, seg in enumerate(manifest["segments"]):
            name = seg.get("name", f"seg{i}")
            print(f"\n[{i+1}/{len(manifest['segments'])}] {name} ({seg['type']}, {seg['duration']}s)")
            duration = float(seg["duration"])

            # 1) Generate narration audio for this segment
            audio_path = tmp / f"{i:02d}_{name}.mp3"
            tts_segment(seg.get("narration", ""), voice, tts_model, speed, audio_path)

            # 2) Build the visual
            silent_visual = tmp / f"{i:02d}_{name}.silent.mp4"
            if seg["type"] == "video":
                src_video = tmp / f"{i:02d}_{name}.src.mp4"
                fetch(seg["video_url"], src_video)
                # The Seedance video already has audio we want to discard.
                # We'll go through fit_video_to_segment, which extracts the silent
                # normalized track + muxes our TTS on top.
                final_seg = tmp / f"{i:02d}_{name}.final.mp4"
                fit_video_to_segment(src_video, audio_path, duration, final_seg)
                segment_files.append(final_seg)
            elif seg["type"] == "title_card":
                make_title_card(seg["text"], silent_visual, duration)
                final_seg = tmp / f"{i:02d}_{name}.final.mp4"
                encode_segment_with_audio(silent_visual, audio_path, duration, final_seg)
                segment_files.append(final_seg)
            elif seg["type"] == "photo_montage":
                make_photo_montage(seg["images"], silent_visual, duration, tmp)
                final_seg = tmp / f"{i:02d}_{name}.final.mp4"
                encode_segment_with_audio(silent_visual, audio_path, duration, final_seg)
                segment_files.append(final_seg)
            else:
                raise RuntimeError(f"Unknown segment type: {seg['type']}")

        # 3) Concat all segments
        print("\nConcatenating segments...")
        concat_list = tmp / "concat.txt"
        concat_list.write_text("".join(f"file '{s.resolve()}'\n" for s in segment_files))

        dest = OUT_DIR / f"{ep_id}.mp4"
        # Re-encode at concat time for clean stream alignment
        run_ffmpeg([
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(dest),
        ], "final concat")

        print(f"\nWrote: {dest} ({dest.stat().st_size // 1024} KB)")
        return dest


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: compose-cartoon.py <manifest.json>")
        sys.exit(2)
    manifest_path = Path(sys.argv[1])
    compose(manifest_path)
