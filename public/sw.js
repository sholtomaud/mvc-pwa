const CACHE_NAME = 'todo-app-v1.2.0';
const ASSETS_TO_CACHE = [
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

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[Service Worker] Pre-caching offline assets progressively');
        const cachePromises = ASSETS_TO_CACHE.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Fetch failed for ${url} with status ${response.status}`);
            }
            await cache.put(url, response);
            console.log(`[Service Worker] Pre-cached successfully: ${url}`);
          } catch (error) {
            console.warn(`[Service Worker] Pre-caching skipped for: ${url}. Reason:`, error.message);
          }
        });
        await Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event (Cleanup old caches)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Bypass cache completely for local development origins to prevent cache-locking during development
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

  // 1. Network-First with Cache fallback for navigation documents to avoid Cache-Locks
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

  // 2. Cache-First with Network fallback for static bundle assets
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
          .catch(() => {
            console.log('[Service Worker] Resource fetch failed (offline):', event.request.url);
          });
      })
  );
});
