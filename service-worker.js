/*
 * Thiccctionary service worker (Wave 156 - upgraded).
 *
 * What gets cached and how:
 *   - PRECACHE on install: shell pages + style + icons + offline fallback.
 *   - data/entries.json: stale-while-revalidate (offline gets the last good
 *     copy; refresh always tries network in background).
 *   - images/* and videos/*: cache-first, fall back to network. These
 *     don't change once published so cache hits are safe and a huge win
 *     for repeat reads on mobile.
 *   - Navigations: network-first, fall back to cache, fall back to offline.
 *   - Other GETs: cache-first, fall back to network.
 *
 * The site updates daily, so we DON'T cache HTML aggressively (a stale
 * entry page is worse than waiting on the network).
 */

const VERSION = 'v3-2026-05-17';
const SHELL_CACHE = `thiccctionary-shell-${VERSION}`;
const RUNTIME_CACHE = `thiccctionary-runtime-${VERSION}`;
const OFFLINE_URL = '/404.html';

const PRECACHE = [
  OFFLINE_URL,
  '/',
  '/styles.css?v=64',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
  '/a-z.html',
  '/archive.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // entries.json: stale-while-revalidate (instant from cache, background refresh)
  if (url.pathname === '/data/entries.json') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // images / videos: cache-first
  if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/videos/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Navigations: network-first, fall back to cache, fall back to offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Tuck a copy in runtime cache for future offline reads
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Everything else: cache-first then network
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    // Network failed and no cache - return a 404-equivalent
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('Offline', { status: 503 });
}

// Allow page to ping us to skip waiting (so a new SW activates immediately
// when the user accepts an update banner).
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
