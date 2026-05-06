/**
 * GET /api/today
 *
 * Returns today's Thiccctionary entry as JSON. Stable for any bot / display /
 * Slack-app / Discord-bot integration. Updates once per day (UTC) when the
 * cron pipeline ships a new entry.
 *
 * Response shape:
 *   {
 *     date, word, pronunciation, partOfSpeech,
 *     definitions, etymology, example,
 *     image: { url, caption, credit },
 *     tags,
 *     url: "https://thiccctionary.com/entries/<date>.html"
 *   }
 *
 * CORS: open. Anyone can fetch from anywhere.
 */

const SITE = 'https://thiccctionary.com';

function pickToday(entries) {
  // entries.json is sorted desc by date. The first one is "today" by editorial
  // definition (the one that was published most recently).
  return entries[0];
}

function shape(e) {
  if (!e) return null;
  const url = `${SITE}/entries/${e.date}.html`;
  const imageUrl = e.image ? `${SITE}/${String(e.image).replace(/^\.?\//, '')}` : null;
  return {
    date: e.date,
    word: e.word,
    pronunciation: e.pronunciation || null,
    partOfSpeech: e.partOfSpeech || 'n.',
    definitions: e.definitions || [],
    etymology: e.etymology || null,
    example: e.example || null,
    image: imageUrl ? {
      url: imageUrl,
      caption: e.caption || null,
      credit: e.credit || null
    } : null,
    tags: e.tags || [],
    url
  };
}

export async function onRequestGet() {
  try {
    // Pull entries.json from our own origin so the function and the static
    // site stay aligned without redeploying functions.
    const resp = await fetch(`${SITE}/data/entries.json`, {
      cf: { cacheEverything: true, cacheTtl: 600 }
    });
    if (!resp.ok) {
      return jsonError('Could not load entries', 503);
    }
    const entries = await resp.json();
    if (!Array.isArray(entries) || entries.length === 0) {
      return jsonError('No entries found', 503);
    }
    const today = pickToday(entries);
    return jsonResponse(shape(today));
  } catch (e) {
    return jsonError('Internal error: ' + e.message, 500);
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=600'
    }
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*'
    }
  });
}
