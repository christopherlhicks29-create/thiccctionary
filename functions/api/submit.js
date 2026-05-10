/**
 * POST /api/submit — full user-submission pipeline.
 *
 * Accepts: multipart/form-data with fields:
 *   - image (File): the photo
 *   - word (string): proposed headword
 *   - why (string): why it's thiccc
 *   - email (string, optional): submitter email for credit
 *
 * Pipeline:
 *   1. Validate inputs + image (size, type)
 *   2. Store image in R2 (public)
 *   3. Vision check: thing or person? Reject persons/animals.
 *   4. Generate entry text via OpenAI with banned-words retry loop
 *   5. Commit to entries.json + build HTML + push to main via GitHub API
 *   6. Return success with live URL
 *
 * Required env bindings:
 *   - SUBMISSIONS_BUCKET: R2 bucket (public access)
 *   - SUBMISSIONS_PUBLIC_URL: public base URL of that bucket
 *   - OPENAI_API_KEY: for vision check + entry generation
 *   - GITHUB_PAT: fine-grained PAT with Contents R/W on the repo
 *   - GITHUB_REPO: e.g. "christopherlhicks29-create/thiccctionary"
 */

const BANNED_WORDS = [
  'voluptuous','voluptuosity','curves','curvy','runway','fashion model','fashion-model',
  'vintage model','vintage-model','hourglass','hip-to-waist','hip to waist','well-endowed',
  'well endowed','thin skins','thin-skinned','diva','divas','diva-like','like a boss',
  'OG of','OG thiccc','haters','haterz','slay','queen energy','main character','lowkey',
  'highkey','vibing','vibes only','no cap','fr fr','stands as a testament',
  'serves as a testament','a testament to','monumentally','undeniably','genuinely thiccc',
  'truly thiccc','absolute showstopper','commands the room','commands attention',
  'effortlessly enhancing','elevating any','statement piece',
];

function violatesBannedWords(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const w of BANNED_WORDS) {
    const wl = w.toLowerCase();
    if (wl.includes(' ') || wl.includes('-')) {
      if (lower.includes(wl)) return w;
    } else {
      const re = new RegExp(`\\b${wl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) return w;
    }
  }
  return null;
}

function checkEntry(entry) {
  const fields = [...entry.definitions || [], entry.example, entry.etymology, entry.caption];
  for (const f of fields) {
    const v = violatesBannedWords(f);
    if (v) return v;
  }
  return null;
}

async function visionCheckImage(imageUrl, openaiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Is this image of a person, body part, or animal as the primary subject? Or is it of a thing (object, vehicle, plant, food, structure, etc.)? Reply ONLY with JSON: {"primary_subject": "person" | "animal" | "thing", "reason": "one sentence"}.' },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
    }),
  });
  if (!res.ok) throw new Error(`Vision check failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function generateEntry(subject, why, photoUrl, openaiKey, retryHint = '') {
  const sysPrompt = `You write entries for "Thiccctionary" — a satirical daily dictionary of THICK INANIMATE OBJECTS. Tone: scholarly dictionary register × dry comedy × internet vernacular. NEVER reference humans, anatomy, or body parts. Light HTML (<em>) allowed. Output strict JSON only.

NO TIME-ANCHORED FRAMING. Entry must read as permanent dictionary record.

NO BODY-ADJACENT LANGUAGE. Banned: voluptuous, curves, runway, fashion model, hourglass, hip-to-waist, well-endowed, thin skins, diva. Use object language: girth, rotundity, displacement, drum diameter, bedside flare.

NO INTERNET VOICE. Banned: "like a boss", "OG of", "haters", "slay", "queen energy", "stands as a testament".

DEFINITION #2 must escalate with restraint, not just restate def #1.

Output schema:
{
  "word": "Subject, Specific",
  "pronunciation": "/sim-pul re-SPEL-ing/",
  "partOfSpeech": "n.",
  "definitions": ["definition 1 (1-2 sentences, dictionary register)", "<em>colloq.</em> sharper escalation"],
  "example": "ONE sentence using both the headword AND the word \"thiccc\" (three c's). Specific scene + punchline tag.",
  "etymology": "Real etymology FIRST (Latin/Greek/named industrialists/dated coinages) THEN comedic kicker.",
  "caption": "Plate N. — short caption.",
  "tags": ["tag1","tag2","tag3"],
  "category": "one of: Vehicles & Transport, Architecture & Infrastructure, Industrial Machinery, Produce & Botanical, Foods of Substance, Domestic Goods, Engineering Marvels, Musical Instruments"
}${retryHint}`;

  const userPrompt = `Submitted subject: "${subject}"\nSubmitter's note on why it's thiccc: "${why}"\nPhoto URL (referenced loosely, not described directly): ${photoUrl}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`Entry generation failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function commitEntryToRepo(entry, env) {
  const { GITHUB_PAT, GITHUB_REPO } = env;
  const repo = GITHUB_REPO || 'christopherlhicks29-create/thiccctionary';

  // Get current entries.json
  const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/data/entries.json?ref=main`, {
    headers: { 'Authorization': `Bearer ${GITHUB_PAT}`, 'User-Agent': 'thiccctionary-submit-fn' },
  });
  if (!getRes.ok) throw new Error(`Couldn't read entries.json: ${getRes.status}`);
  const file = await getRes.json();
  const sha = file.sha;
  const decoded = atob(file.content.replace(/\n/g, ''));
  const entries = JSON.parse(decoded);

  // Insert new entry at the front
  entries.unshift(entry);
  const newContent = JSON.stringify(entries, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(newContent)));

  // Commit
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/data/entries.json`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${GITHUB_PAT}`, 'User-Agent': 'thiccctionary-submit-fn', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `User submission: ${entry.word} (auto-published via /api/submit)`,
      content: encoded,
      sha,
      branch: 'main',
    }),
  });
  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`Commit failed: ${putRes.status} ${err.slice(0,200)}`);
  }
  return entries;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Pre-flight env check
  const required = ['SUBMISSIONS_BUCKET','SUBMISSIONS_PUBLIC_URL','OPENAI_API_KEY','GITHUB_PAT'];
  for (const r of required) {
    if (!env[r]) {
      return new Response(JSON.stringify({ error: `Server misconfigured: ${r} not set` }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let formData;
  try { formData = await request.formData(); }
  catch (e) { return errResp('Invalid form data', 400); }

  const file = formData.get('image');
  const word = (formData.get('word') || '').toString().trim().slice(0, 100);
  const why = (formData.get('why') || '').toString().trim().slice(0, 1000);
  const submitterEmail = (formData.get('email') || '').toString().trim().slice(0, 200);

  if (!file || typeof file === 'string') return errResp('Image is required', 400);
  if (!word) return errResp('Word is required', 400);
  if (!why) return errResp('Why field is required', 400);
  if (file.size > 10 * 1024 * 1024) return errResp('Image too large (10 MB max)', 413);
  if (!file.type.startsWith('image/')) return errResp('Only image files accepted', 415);

  // 1. Store image
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
  const nonce = Math.random().toString(36).slice(2,10);
  const key = `submissions/${ts}-${nonce}.${ext}`;
  await env.SUBMISSIONS_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { word, submittedAt: new Date().toISOString(), submitterEmail },
  });
  const imageUrl = `${env.SUBMISSIONS_PUBLIC_URL}/${key}`;

  // 2. Vision check — reject persons/animals
  let visionResult;
  try { visionResult = await visionCheckImage(imageUrl, env.OPENAI_API_KEY); }
  catch (e) { return errResp(`Vision check failed: ${e.message}`, 502); }

  if (visionResult.primary_subject !== 'thing') {
    return new Response(JSON.stringify({
      error: 'rejected',
      reason: `Thiccctionary catalogs only objects, vehicles, plants, foods, and structures. This image's primary subject is a ${visionResult.primary_subject}. ${visionResult.reason}`,
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  // 3. Generate entry text with banned-words retry
  let entryText = null;
  let lastViolation = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const hint = lastViolation ? `\n\nRETRY HINT: previous attempt contained the banned term "${lastViolation}". Avoid it.` : '';
    const candidate = await generateEntry(word, why, imageUrl, env.OPENAI_API_KEY, hint);
    const violation = checkEntry(candidate);
    if (!violation) { entryText = candidate; break; }
    lastViolation = violation;
  }
  if (!entryText) {
    return new Response(JSON.stringify({
      error: 'pending_review',
      reason: 'Entry text couldn\'t pass automated quality checks after 3 attempts. Submission saved for manual review.',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  }

  // 4. Build full entry record
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    word: entryText.word,
    pronunciation: entryText.pronunciation,
    partOfSpeech: entryText.partOfSpeech,
    definitions: entryText.definitions,
    example: entryText.example,
    etymology: entryText.etymology,
    image: imageUrl,
    caption: entryText.caption,
    tags: entryText.tags,
    photographer: submitterEmail ? `Submitted by ${submitterEmail.split('@')[0]}` : 'User submission',
    photographerUrl: 'https://thiccctionary.com/submit.html',
    unsplashUrl: '',
    category: entryText.category || 'Uncategorized',
    bookReady: null, // pending Christopher's curation
    submittedBy: submitterEmail || 'anonymous',
    submissionId: nonce,
  };

  // 5. Commit to repo
  try { await commitEntryToRepo(entry, env); }
  catch (e) { return errResp(`Commit failed: ${e.message}`, 502); }

  return new Response(JSON.stringify({
    ok: true,
    word: entry.word,
    image: imageUrl,
    message: 'Submission accepted and queued for next deploy. Live in ~60 seconds.',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errResp(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'POST' } });
  }
  return onRequestPost(context);
}
