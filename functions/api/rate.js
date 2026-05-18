/**
 * /api/rate, Cloudflare Pages Function
 *
 * Proxies image classification requests to OpenAI's GPT-4o vision API
 * with the Thiccctionary editorial system prompt.
 *
 * Cloudflare Pages auto-discovers this file. No separate Worker setup.
 *
 * Required env var (set in Cloudflare Pages dashboard → Settings → Env vars):
 *   OPENAI_API_KEY , same key used for image generation
 *
 * Request body (JSON):
 *   { "imageUrl": "https://..." }     , remote URL
 *   OR
 *   { "imageDataUrl": "data:image/jpeg;base64,..." }
 *
 * Response (JSON):
 *   On success: { subject, rating, commentary, tags, closest? }
 *   On refusal: { refused: true, reason: "human subject" | "illegible" }
 *   On error:   { error: "..." }
 */

const SYSTEM_PROMPT = `You are the editorial apparatus of Thiccctionary, a satirical daily dictionary of objects of unusual girth. Strictly things, never people.

Your job: rate one photograph for thicccness on a 1.0 to 10.0 scale, with one decimal, and write commentary in the dictionary register.

WHAT 'THICCC' MEANS, three legitimate senses, pick the one most salient for THIS photograph:

1. GIRTH / SILHOUETTE, the default. Things with visible volume, curve, mass: cement mixers, F-450 dually, side-by-side fridges, championship pumpkins.

2. DENSITY / MATERIAL, solid, packed, structurally substantial: poured concrete, brutalist bunkers, a wheel of Parmigiano-Reggiano, dense bread loaves, billet steel.

3. VISCOSITY / SUBSTANCE, the contents, not the container. If the SUBJECT is famously viscous (honey, molasses, motor oil, thickened liquids, magma, peanut butter, latex paint), rate the SUBSTANCE, not the bottle holding it. A standard bottle of Thick-It thickened water gets a real rating because the liquid inside IS scientifically thicc, that's the entire product. Don't mark down the rating because the BOTTLE is normal-shaped; the bottle is just the delivery mechanism for the joke.

When the subject is in a viscous category, your commentary should call out the substance directly: "A polysaccharide-thickened beverage of considered viscosity, moves like a glacier." For shape-thicc subjects, talk silhouette. For density-thicc subjects, talk mass. Pick the right axis for the photo, then commit.

VOICE:
- Pseudo-academic, dry, faintly Victorian. Like a 1924 trade journal.
- No em-dashes anywhere (use commas, periods, colons, parens).
- No promotional language. No "groundbreaking" or "stunning". This is criticism, not marketing.
- Write 2-3 sentences of commentary. Specific. Reference the silhouette, the ratio, the character.

RULES:
- If the image contains a person, a face, a body, or any human subject: refuse. Output exactly: {"refused": true, "reason": "human subject"}
- If the image is illegible, blurry beyond recognition, or empty: refuse with reason "illegible".
- Otherwise: identify what the object is (a noun phrase), rate its thicccness, and write commentary.

OUTPUT FORMAT (strict JSON, no surrounding text):
{
  "subject": "fire hydrant, municipal",
  "rating": 8.5,
  "commentary": "A solid lower-third stance with a tapered bonnet, the chamfer is the only thing keeping this off the medal podium. The chains contribute girth without protruding; the paint, oxblood by ordinance, is appropriate.",
  "tags": ["industrial", "municipal", "iron"]
}

GRADING REFERENCE (calibration, across all three thicccness senses):
- 9.5-10: defines the form. Cement mixer (girth), Bagger 288 (density), industrial molasses tank in flow (viscosity), Saturn V.
- 8.0-9.4: textbook example. F-450 dually, side-by-side fridge, Atlantic Giant pumpkin, honey from the comb, Thick-It Pudding-thick formula.
- 6.5-7.9: meets the standard. Chesterfield sofa, banana, mailbox, Thick-It Nectar-thick (mid viscosity), motor oil cold-poured.
- 5.0-6.4: present but unremarkable. Standard sedan, regular tomato, regular maple syrup, room-temp olive oil.
- 1.0-4.9: thin or insubstantial. Whippet, lamppost, drinking straw, water (visually proves the entire concept of thinness).

Return only valid JSON. No markdown, no explanation outside the JSON.`;

async function findClosestEntry(env, subject, tags) {
  // Best-effort archive-link enrichment. We fetch the public entries.json
  // from our own origin and pick the entry with the most tag overlap.
  // Failures here are non-fatal, we just return null.
  try {
    const resp = await fetch('https://thiccctionary.com/data/entries.json', {
      cf: { cacheEverything: true, cacheTtl: 3600 }
    });
    if (!resp.ok) return null;
    const entries = await resp.json();
    if (!Array.isArray(entries) || entries.length === 0) return null;

    const lowerTags = (tags || []).map(t => String(t).toLowerCase());
    const lowerSubject = String(subject || '').toLowerCase();

    let best = null;
    let bestScore = 0;
    for (const e of entries) {
      const eTags = (e.tags || []).map(t => String(t).toLowerCase());
      let score = 0;
      for (const t of lowerTags) if (eTags.includes(t)) score += 2;
      // Word overlap with subject
      const ew = String(e.word || '').toLowerCase();
      for (const w of lowerSubject.split(/\s+/)) {
        if (w.length > 3 && ew.includes(w)) score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { word: e.word, date: e.date };
      }
    }
    return bestScore >= 2 ? best : null;
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Sanity-check API key
  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({
      error: "OPENAI_API_KEY not configured. Set it in Cloudflare Pages → Settings → Env vars (Production)."
    }), { status: 503, headers: { 'content-type': 'application/json' } });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const imageUrl = body.imageDataUrl || body.imageUrl;
  if (!imageUrl) {
    return new Response(JSON.stringify({ error: 'Missing imageUrl or imageDataUrl' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  // Reasonable size guard: data URLs over ~10MB get rejected
  if (imageUrl.length > 12 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Image too large (max ~10MB)' }), {
      status: 413, headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }
          ]}
        ],
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      console.error('OpenAI error:', openaiResp.status, errText.slice(0, 500));
      return new Response(JSON.stringify({
        error: `OpenAI API returned ${openaiResp.status}`,
        detail: errText.slice(0, 200)
      }), { status: 502, headers: { 'content-type': 'application/json' } });
    }

    const json = await openaiResp.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: 'OpenAI returned empty response' }), {
        status: 502, headers: { 'content-type': 'application/json' }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'OpenAI returned non-JSON content',
        raw: content.slice(0, 500)
      }), { status: 502, headers: { 'content-type': 'application/json' } });
    }

    // Refusal short-circuit
    if (parsed.refused) {
      return new Response(JSON.stringify(parsed), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    // Validate the success shape
    if (typeof parsed.rating !== 'number' || !parsed.subject || !parsed.commentary) {
      return new Response(JSON.stringify({
        error: 'OpenAI returned unexpected shape',
        raw: content.slice(0, 500)
      }), { status: 502, headers: { 'content-type': 'application/json' } });
    }

    // Clamp rating to 1.0–10.0
    parsed.rating = Math.max(1.0, Math.min(10.0, Number(parsed.rating)));

    // Enrich with closest archive entry (best-effort)
    parsed.closest = await findClosestEntry(env, parsed.subject, parsed.tags);

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    console.error('Function error:', e);
    return new Response(JSON.stringify({ error: 'Internal error: ' + e.message }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}

export async function onRequestGet() {
  // GET returns metadata about the function so the page can render a
  // configuration-not-yet-set notice without making a real request.
  return new Response(JSON.stringify({
    endpoint: '/api/rate',
    method: 'POST',
    accepts: ['imageUrl', 'imageDataUrl'],
    voice: 'thiccctionary editorial register',
    note: 'POST an image to receive a thicccness rating with commentary.'
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
