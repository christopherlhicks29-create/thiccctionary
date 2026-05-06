/**
 * GET /api/random
 *
 * Returns one random Thiccctionary entry as JSON. Same shape as /api/today.
 * Useful for "shuffle" features in third-party integrations.
 */

const SITE = 'https://thiccctionary.com';

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
    const resp = await fetch(`${SITE}/data/entries.json`, {
      cf: { cacheEverything: true, cacheTtl: 600 }
    });
    if (!resp.ok) return jsonError('Could not load entries', 503);
    const entries = await resp.json();
    if (!Array.isArray(entries) || entries.length === 0) return jsonError('No entries', 503);
    const pick = entries[Math.floor(Math.random() * entries.length)];
    return jsonResponse(shape(pick));
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
      'cache-control': 'no-store'  // random must not be cached
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
