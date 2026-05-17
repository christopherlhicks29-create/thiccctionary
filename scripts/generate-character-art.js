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
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('FATAL: OPENAI_API_KEY missing'); process.exit(1); }

const SCENE_ID = (process.env.SCENE_ID || '').trim();
if (!SCENE_ID) { console.error('FATAL: SCENE_ID required'); process.exit(1); }
const SCENE_IDS = SCENE_ID.split(',').map(s => s.trim()).filter(Boolean);

const BASE_STYLE = "Editorial cartoon in the style of vintage New Yorker single-panel cartoons. Black ink line work with selective muted color, warm cream paper background (#f5e8c7), small spot oxblood (#8b1f1f) accents only where called for. Dry, observational character expressions. Mid-century print-magazine aesthetic. 1:1 square. CRITICAL: do NOT render any caption text, label text, or text underneath the image. Any text on visible props inside the scene (signs, labels, etc) should be limited to 1-3 words maximum and spelled correctly. Default to NO TEXT.";

async function visionQA(imageBuffer, sceneDesc) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.log('[char-art] no ANTHROPIC_API_KEY, skipping vision QA');
    return { pass: true, score: null };
  }
  const b64 = imageBuffer.toString('base64');
  const sys = `You review editorial-cartoon portraits for Thiccctionary, a satirical publication. Score on a 0-10 scale and return JSON: {"score": 0-10, "verdict": "publish"|"reject", "issues": ["specific issues"], "strengths": ["specific strengths"]}.

REJECT (score < 7) if ANY of these are true:
- Any text, words, letters, or readable labels visible ANYWHERE in the image (the bible explicitly forbids rendered text)
- Anatomical errors (extra fingers, distorted features, etc)
- Off-style (not editorial-cartoon / New Yorker single-panel feel)
- Props in description are not visually identifiable (e.g., the prop is supposed to be 'open tin of lozenges' but it looks like a featureless block)
- Style is gritty, photographic, or modern-digital rather than ink-line editorial cartoon
- Composition unbalanced or amateur

PUBLISH (score >= 7) if: clean editorial cartoon style, props are visually unambiguous, no rendered text, character expression matches description.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: sys,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: `Cartoon description from the bible:\n${sceneDesc}\n\nReview the image. Return JSON only.` },
        ],
      }],
    }),
  });
  if (!res.ok) { console.error('[char-art] vision QA failed:', res.status, await res.text()); return { pass: true, score: null, issues: ['vision API error'] }; }
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { pass: true, score: null, issues: ['no JSON returned'] };
  const rating = JSON.parse(m[0]);
  return { pass: rating.verdict === 'publish' && rating.score >= 7, ...rating };
}

function overlayCaption(inputPath, outputPath, caption) {
  if (!caption) {
    // No caption — just copy file
    execFileSync('cp', [inputPath, outputPath]);
    return;
  }
  execFileSync('python3', [path.join(__dirname, 'overlay-cartoon-caption.py'), inputPath, outputPath, caption], { stdio: 'inherit' });
}

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
  let successes = 0, failures = 0;
  for (const sceneId of SCENE_IDS) {
    const scene = bible.scenes.find(s => s.id === sceneId);
    if (!scene) {
      console.error(`Scene "${sceneId}" not found in bible. Skipping.`);
      failures++;
      continue;
    }
    console.log(`\n[char-art] generating scene: ${scene.id}`);
    console.log(`[char-art] ${scene.description}`);
    try {
      const fullPrompt = `${scene.scene_prompt}\n\nSTYLE: ${BASE_STYLE}`;
      let buf = null;
      let lastRating = null;
      // Up to 2 attempts: generate → vision QA → retry if rejected
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[char-art] attempt ${attempt}/2: calling gpt-image-1…`);
        buf = await generateImage(fullPrompt);
        console.log(`[char-art] vision QA on attempt ${attempt}…`);
        const rating = await visionQA(buf, scene.scene_prompt);
        lastRating = rating;
        if (rating.score !== null) {
          console.log(`[char-art]   score=${rating.score}/10 verdict=${rating.verdict}`);
          (rating.issues || []).forEach(i => console.log(`     issue: ${i}`));
        }
        if (rating.pass) break;
        console.log(`[char-art]   retrying...`);
      }
      if (!lastRating?.pass) {
        console.error(`[char-art] FAILED QA after 2 attempts. score=${lastRating?.score} issues=${JSON.stringify(lastRating?.issues)}`);
        failures++;
        continue;
      }
      if (process.env.DRY_RUN === '1') {
        console.log('[char-art] DRY_RUN=1, not writing image');
        successes++;
        continue;
      }
      // Save raw + composited image
      const outPath = path.join(ROOT, scene.output_path);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const rawPath = outPath.replace(/\.png$/, '.raw.png');
      await fs.writeFile(rawPath, buf);
      // Overlay caption
      const caption = scene.caption_text || '';
      overlayCaption(rawPath, outPath, caption);
      await fs.unlink(rawPath).catch(() => {});
      const finalSize = (await fs.stat(outPath)).size;
      console.log(`[char-art] wrote ${outPath} (${finalSize} bytes) with caption: "${caption}"`);
      scene.generated_at = new Date().toISOString();
      scene.file_size = finalSize;
      scene.qa_score = lastRating?.score;
      successes++;
    } catch (e) {
      console.error(`[char-art] error for ${sceneId}: ${e.message}`);
      failures++;
    }
  }
  // Write bible updates after all scenes attempted
  await fs.writeFile(path.join(ROOT, 'data', 'character-art-prompts.json'), JSON.stringify(bible, null, 2) + '\n', 'utf8');
  console.log(`\n[char-art] done. successes=${successes} failures=${failures}`);
}

main().catch(err => { console.error('[char-art] FATAL:', err.message); process.exit(1); });
