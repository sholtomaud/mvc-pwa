/* eslint-env serviceworker */

// Injected at build time by the `sw-precache-manifest` plugin in
// vite.config.ts: the complete list of files emitted to dist/ (hashed JS/CSS
// bundles, index.html, manifest, icons) plus a content-derived build id.
// In dev these stay null — the fetch handler bypasses localhost anyway.
self.__PRECACHE_MANIFEST = null;
self.__BUILD_ID = null;

// Fallback list is used when the manifest was not injected — i.e. when the
// raw public/sw.js is served by the dev server. It mirrors the app's source
// asset paths (these exist as real URLs in dev; in production builds the
// injected manifest replaces this entirely).
const PRECACHE = self.__PRECACHE_MANIFEST || [
  './',
  'index.html',
  'styles/main.css',
  'manifest.json',
  'images/app-icon48.png',
  'images/app-icon72.png',
  'images/app-icon96.png',
  'images/app-icon144.png',
  'images/app-icon168.png',
  'images/app-icon192.png',
  'images/app-icon512.png'
];
const CACHE_NAME = `todo-app-${self.__BUILD_ID || 'dev'}`;

// Install: pre-cache the full build manifest so the app works offline from
// the very first visit, not only after every asset has been browsed once.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        const cachePromises = PRECACHE.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
              throw new Error(`Fetch failed for ${url} with status ${response.status}`);
            }
            await cache.put(url, response);
          } catch {
            // Tolerate individual misses so one flaky asset can't block install.
          }
        });
        await Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: drop caches from previous builds.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cache) => cache !== CACHE_NAME)
          .map((cache) => caches.delete(cache))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Bypass cache completely for local development origins to prevent
  // cache-locking during development.
  const url = new URL(event.request.url);
  if (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.startsWith('192.168.') ||
    url.port === '5173'
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 1. Network-first with cache fallback for navigation documents, so a new
  //    deploy's index.html (and the hashed assets it references) wins when
  //    online, while offline visits still get the cached shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 2. Cache-first with network fallback for static assets. Hashed bundle
  //    filenames make stale cache hits impossible across deploys.
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });

            return networkResponse;
          })
          .catch(() => undefined);
      })
  );
});
