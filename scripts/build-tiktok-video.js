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
      instructions: 'Read in a calm, deadpan tone, like a dictionary narrator on a documentary. Pause briefly after each sentence. Slightly slower than conversational pace. Dry, dignified delivery — never excited or salesy. Critical: end every sentence with a falling, declarative cadence — never let the final sentence rise as if continuing.',
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
  // cadence — bare "Thiccctionary" was being read with rising intonation.
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

  // Combine headword + (n.) into one drawtext — single-call avoids overlap bugs
  const headwordLine = escFFText(`${entry.word} (n.)`);
  const filterParts = [
    `[0:v]scale=1080:-1:force_original_aspect_ratio=decrease,pad=1080:1920:0:(1920-ih)/2:color=${CREAM}[bg]`,
    `[bg]drawtext=fontfile=${FONT}:text='${headwordLine}':fontcolor=${INK}:fontsize=70:x=(w-text_w)/2:y=240[h1]`,
    `[h1]drawbox=x=194:y=350:w=692:h=3:color=${INK}:t=fill[h2]`,
    `[h2]drawtext=fontfile=${FONT}:text='thiccc':fontcolor=${INK}:fontsize=220:x=(w-text_w)/2:y=1540:enable='gte(t,2)'[h3]`,
    `[h3]drawtext=fontfile=${FONT_ITALIC}:text='thiccctionary.com':fontcolor=${OXBLOOD}:fontsize=38:x=(w-text_w)/2:y=h-90[v]`,
  ];

  const ffArgs = [
    '-y',
    '-loop', '1', '-t', String(totalDuration), '-i', imagePath,
    '-i', audioPath,
    '-filter_complex', filterParts.join(';'),
    '-map', '[v]', '-map', '1:a',
    '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    videoPath,
  ];
  console.log('Running ffmpeg...');
  await run('ffmpeg', ffArgs);
  console.log(`\nBuilt ${path.relative(ROOT, videoPath)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
