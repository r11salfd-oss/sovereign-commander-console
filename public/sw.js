// Sovereign Commander Console - High Performance Service Worker v3.8
const CACHE_VERSION = 'v3.8.3';
const STATIC_CACHE = `sov-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `sov-dynamic-${CACHE_VERSION}`;

// Critical Shell Assets to pre-cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.svg',
  '/icons/icon-maskable-512.svg',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[PWA-SW] Pre-caching partial notice:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept POST/PUT/DELETE or non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 2. Bypass live AI and Auth API routes to guarantee fresh responses
  if (
    url.pathname.startsWith('/api/chat') ||
    url.pathname.startsWith('/api/hitl/propose') ||
    url.pathname.startsWith('/api/tests') ||
    url.pathname.startsWith('/api/qa/pen-test') ||
    url.pathname.startsWith('/api/kernel/ipc') ||
    url.pathname.includes('firestore.googleapis.com') ||
    url.pathname.includes('identitytoolkit.googleapis.com') ||
    url.pathname.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  // 3. Navigation Requests (HTML Pages): Network-first with offline.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const fallback = await caches.match('/offline.html');
          return fallback || new Response('Offline - No connection', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
    );
    return;
  }

  // 4. Static Assets (JS, CSS, SVGs, Fonts, Icons): Cache-First with Background Revalidation
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|webp|woff|woff2|ttf|eot)$/) ||
    url.origin.includes('fonts.googleapis.com') ||
    url.origin.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Revalidate in background
          fetch(request)
            .then((fresh) => {
              if (fresh && fresh.status === 200) {
                caches.open(STATIC_CACHE).then((c) => c.put(request, fresh));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 5. Stale-While-Revalidate for idempotent system telemetry reads
  if (url.pathname === '/api/brainmap' || url.pathname === '/api/workspace/info') {
    event.respondWith(
      caches.open(DYNAMIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((networkResp) => {
            if (networkResp && networkResp.status === 200) {
              cache.put(request, networkResp.clone());
            }
            return networkResp;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});
