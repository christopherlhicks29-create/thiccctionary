/**
 * Build a 9:16 vertical TikTok video for a given Thiccctionary entry.
 *
 * Pipeline:
 *   1. Read entry from data/entries.json by date
 *   2. Generate voiceover MP3 via OpenAI TTS (model: gpt-4o-mini-tts, voice: onyx)
 *   3. Use ffmpeg to compose the image + typography + audio into a 1080x1920 MP4
 *
 * Triggered by .github/workflows/build-tiktok.yml (manual only).
 *
 * Required env vars:
 *   - OPENAI_API_KEY
 *   - DATE                       YYYY-MM-DD of the entry to build
 *
 * Outputs: tiktok-output/<DATE>-<slug>.mp4
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const OUT_DIR = path.join(ROOT, 'tiktok-output');

// Brand colors
const CREAM = '0xF4ECDC';
const INK = '0x1A1410';
const OXBLOOD = '0x7A1F1F';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

function escFFText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '’')
    .replace(/,/g, '\\,');
}

// Burned captions, synced approximately (by character-length share of the
// voiceover's measured duration) so the reel still tells its story when
// watched muted, which is most of the time on FB/IG/TikTok feeds. Not
// word-perfect (no ASR pass on the TTS output), but clause-level chunks land
// close enough to read naturally against the deadpan pacing.
function splitCaptionChunks(script) {
  const MAX_LEN = 42; // keep each on-screen line short and legible
  const sentences = (script.match(/[^.!?]+[.!?]*/g) || [script]).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  const wrapWords = (text) => {
    const words = text.trim().split(/\s+/);
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > MAX_LEN) {
        if (line) chunks.push(line.trim());
        line = w;
      } else {
        line = (line + ' ' + w).trim();
      }
    }
    if (line) chunks.push(line.trim());
  };
  for (const sentence of sentences) {
    if (sentence.length <= MAX_LEN) { chunks.push(sentence); continue; }
    for (const part of sentence.split(/,\s*/)) {
      if (part.length <= MAX_LEN) chunks.push(part.trim());
      else wrapWords(part);
    }
  }
  return chunks.filter(Boolean);
}

function buildCaptionTimings(chunks, audioDuration) {
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
  let elapsed = 0;
  return chunks.map(text => {
    const share = text.length / totalChars;
    const dur = Math.max(0.6, share * audioDuration);
    const start = elapsed;
    const end = Math.min(audioDuration, elapsed + dur);
    elapsed = end;
    return { text, start, end };
  });
}

async function generateVoiceover(text, outPath) {
  console.log('Calling OpenAI TTS...');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: text,
      instructions: 'Read in a calm, deadpan tone, like a dictionary narrator on a documentary. Pause briefly after each sentence. Slightly slower than conversational pace. Dry, dignified delivery, never excited or salesy. Critical: end every sentence with a falling, declarative cadence, never let the final sentence rise as if continuing.',
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`Saved voiceover (${buf.length} bytes) -> ${outPath}`);
}

async function probeDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', code => code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error('ffprobe failed')));
  });
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required.');
    process.exit(1);
  }
  const date = (process.env.DATE || '').trim();
  if (!date) {
    console.error('DATE required (YYYY-MM-DD).');
    process.exit(1);
  }

  const entries = JSON.parse(await fs.readFile(ENTRIES_PATH, 'utf8'));
  const entry = entries.find(e => e.date === date);
  if (!entry) {
    console.error(`No entry for ${date}`);
    process.exit(1);
  }

  // Closing line ends with "thiccctionary dot com" so the TTS gets a falling
  // cadence, bare "Thiccctionary" was being read with rising intonation.
  const cleanEtymology = entry.etymology.replace(/<[^>]+>/g, '').trim();
  const script = `${entry.word}. The thiccc one. ${cleanEtymology}`;
  console.log(`Script (${script.length} chars):\n${script}\n`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const slug = entry.word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const audioPath = path.join(OUT_DIR, `${date}-${slug}.mp3`);
  const videoPath = path.join(OUT_DIR, `${date}-${slug}.mp4`);
  const imagePath = path.resolve(ROOT, entry.image);

  await generateVoiceover(script, audioPath);
  const audioDuration = await probeDuration(audioPath);
  const totalDuration = Math.max(15, Math.ceil(audioDuration + 0.5));
  console.log(`Audio duration: ${audioDuration.toFixed(2)}s. Video duration: ${totalDuration}s.`);

  const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
  const FONT_ITALIC = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf';

  // Wave 304: platform-safe layout. FB/IG reels crop ~9% off each side on
  // tall phones and overlay UI on roughly the bottom 420px, so every text
  // element must live inside x 120..960 and above y 1500. The headword is
  // sized to fit instead of fixed at 70 (long titles like "Cake, Wedding
  // Three-Tier (n.)" used to overflow the frame and clip on both sides).
  const headwordRaw = `${entry.word} (n.)`;
  // DejaVu Serif Bold averages ~0.63em advance per char.
  const fitFont = (text, maxWidth, cap) =>
    Math.min(cap, Math.floor(maxWidth / (0.63 * text.length)));
  let headwordText = headwordRaw;
  let headFS = fitFont(headwordText, 840, 64);
  if (headFS < 34) {           // extremely long title: drop the (n.) suffix
    headwordText = entry.word;
    headFS = Math.max(30, fitFont(headwordText, 840, 64));
  }
  const headwordLine = escFFText(headwordText);
  // Image scaled to 920 wide (not 1080) so it clears the side crop, seated
  // between the title block and the wordmark band.
  // Ken Burns: slow continuous zoom on the (already letterbox-padded) 920x840
  // frame so the reel has motion instead of sitting on one dead still frame
  // for 15-20s. Capped at 1.15x over the full clip, gentle enough not to
  // crop into the subject the photo-critic already verified is fully framed.
  const filterParts = [
    `[0:v]scale=920:840:force_original_aspect_ratio=decrease,pad=920:840:(920-iw)/2:(840-ih)/2:color=${CREAM},zoompan=z='min(zoom+0.0012,1.15)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=920x840:fps=30[kb]`,
    `[kb]pad=1080:1920:(1080-iw)/2:420:color=${CREAM}[bg]`,
    `[bg]drawtext=fontfile=${FONT}:text='${headwordLine}':fontcolor=${INK}:fontsize=${headFS}:x=(w-text_w)/2:y=210[h1]`,
    `[h1]drawbox=x=194:y=310:w=692:h=3:color=${INK}:t=fill[h2]`,
    `[h2]drawtext=fontfile=${FONT_ITALIC}:text='thiccctionary.com':fontcolor=${OXBLOOD}:fontsize=36:x=(w-text_w)/2:y=346[h3]`,
  ];

  // Burned captions chained in after the title block, before the "thiccc"
  // reveal (which must stay the final node feeding [v]).
  const captionChunks = splitCaptionChunks(script);
  const captionTimings = buildCaptionTimings(captionChunks, audioDuration);
  let prevLabel = 'h3';
  captionTimings.forEach((cue, i) => {
    const label = `cap${i}`;
    const fitCaption = Math.floor(1000 / (0.56 * Math.max(cue.text.length, 1)));
    const capFS = Math.max(34, Math.min(50, fitCaption));
    const capText = escFFText(cue.text);
    filterParts.push(
      `[${prevLabel}]drawtext=fontfile=${FONT}:text='${capText}':fontcolor=white:fontsize=${capFS}:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=1090:enable='between(t\,${cue.start.toFixed(2)}\,${cue.end.toFixed(2)})'[${label}]`
    );
    prevLabel = label;
  });

  filterParts.push(
    `[${prevLabel}]drawtext=fontfile=${FONT}:text='thiccc':fontcolor=${INK}:fontsize=160:x=(w-text_w)/2:y=1310:enable='gte(t,2)'[v]`
  );

  const ffArgs = [
    '-y',
    '-loop', '1', '-t', String(totalDuration), '-i', imagePath,
    '-i', audioPath,
    '-filter_complex', filterParts.join(';'),
    '-map', '[v]', '-map', '1:a',
    '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',  // Wave 280: FB Reels rejects the TTS-native 24kHz mono; IG tolerates it. Resample so both accept.
    '-shortest',
    '-movflags', '+faststart',
    videoPath,
  ];
  console.log('Running ffmpeg...');
  await run('ffmpeg', ffArgs);
  console.log(`\nBuilt ${path.relative(ROOT, videoPath)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
