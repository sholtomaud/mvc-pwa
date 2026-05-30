const CACHE_NAME = 'todo-app-v1.2.0';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/manifest.json',
  '/scripts/components/todo-item.html',
  '/scripts/components/todo-item.css',
  '/scripts/components/todo-item.css?inline',
  '/scripts/components/todo-item.ts',
  '/scripts/components/todo-input.html',
  '/scripts/components/todo-input.css',
  '/scripts/components/todo-input.css?inline',
  '/scripts/components/todo-input.ts',
  '/scripts/components/todo-list.html',
  '/scripts/components/todo-list.css',
  '/scripts/components/todo-list.css?inline',
  '/scripts/components/todo-list.ts',
  '/scripts/components/todo-app.html',
  '/scripts/components/todo-app.css',
  '/scripts/components/todo-app.css?inline',
  '/scripts/components/todo-app.ts',
  '/scripts/components/app-navigation.html',
  '/scripts/components/app-navigation.css',
  '/scripts/components/app-navigation.css?inline',
  '/scripts/components/app-navigation.ts',
  '/scripts/components/user-profile.html',
  '/scripts/components/user-profile.css',
  '/scripts/components/user-profile.css?inline',
  '/scripts/components/user-profile.ts',
  '/images/app-icon48.png',
  '/images/app-icon72.png',
  '/images/app-icon96.png',
  '/images/app-icon144.png',
  '/images/app-icon168.png',
  '/images/app-icon192.png',
  '/images/app-icon512.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline assets');
        return cache.addAll(ASSETS_TO_CACHE);
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
