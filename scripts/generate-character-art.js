/**
 * Character art generator.
 *
 * Uses OpenAI gpt-image-1 to produce editorial-cartoon-style staff illustrations.
 *
 * Reads:
 *   data/character-art-prompts.json — bible of scenes/portraits per character
 *
 * Writes:
 *   images/staff/<id>-<scene>.png  (or whichever output_path the scene specifies)
 *
 * Env:
 *   OPENAI_API_KEY  — required
 *   SCENE_ID        — required, scene id from the bible to render
 *   DRY_RUN         — '1' to skip writing the image
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('FATAL: OPENAI_API_KEY missing'); process.exit(1); }

const SCENE_ID = (process.env.SCENE_ID || '').trim();
if (!SCENE_ID) { console.error('FATAL: SCENE_ID required'); process.exit(1); }

const BASE_STYLE = "Editorial cartoon in the style of vintage New Yorker single-panel cartoons. Black ink line work with selective muted color, warm cream paper background (#f5e8c7), small spot oxblood (#8b1f1f) accents only where called for. Dry, observational character expressions. Mid-century print-magazine aesthetic. 1:1 square.";

async function generateImage(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1024',
      n: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI image API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('No b64_json in response: ' + JSON.stringify(data).slice(0, 300));
  return Buffer.from(b64, 'base64');
}

async function main() {
  const bibleRaw = await fs.readFile(path.join(ROOT, 'data', 'character-art-prompts.json'), 'utf8');
  const bible = JSON.parse(bibleRaw);
  const scene = bible.scenes.find(s => s.id === SCENE_ID);
  if (!scene) {
    console.error(`Scene "${SCENE_ID}" not found in bible. Available: ${bible.scenes.map(s => s.id).join(', ')}`);
    process.exit(1);
  }
  console.log(`[char-art] generating scene: ${scene.id}`);
  console.log(`[char-art] description: ${scene.description}`);

  const fullPrompt = `${scene.scene_prompt}\n\nSTYLE: ${BASE_STYLE}`;
  console.log(`[char-art] calling gpt-image-1…`);
  const buf = await generateImage(fullPrompt);

  if (process.env.DRY_RUN === '1') {
    console.log('[char-art] DRY_RUN=1, not writing image');
    return;
  }

  const outPath = path.join(ROOT, scene.output_path);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  console.log(`[char-art] wrote ${outPath} (${buf.length} bytes)`);

  // Update bible to mark scene as generated
  scene.generated_at = new Date().toISOString();
  scene.file_size = buf.length;
  await fs.writeFile(path.join(ROOT, 'data', 'character-art-prompts.json'), JSON.stringify(bible, null, 2) + '\n', 'utf8');
  console.log('[char-art] bible updated');
}

main().catch(err => { console.error('[char-art] FATAL:', err.message); process.exit(1); });
