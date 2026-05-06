/*
 * Thiccctionary service worker.
 *
 * Minimal — just enough to be installable as a PWA on mobile.
 * Strategy: cache the offline-fallback page on install. Network-first
 * for everything else; on network failure, fall back to the cached
 * offline page for navigations only.
 *
 * Deliberately NOT caching daily entries or images aggressively. The
 * site updates daily; staleness is worse than a brief network blip.
 */

const CACHE_NAME = 'thiccctionary-v1';
const OFFLINE_URL = '/404.html';
const PRECACHE = [OFFLINE_URL, '/styles.css', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GETs; let everything else pass through.
  if (req.method !== 'GET') return;

  // For navigations: network-first, fall back to offline page on failure.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // For other GETs: try cache first, then network. Don't aggressively
  // cache fresh fetches — that's what HTTP caching is for.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req))
  );
});
