/**
 * Yomikomi Service Worker - Offline App Shell & Smart Cache
 * Provides instantaneous offline loading and smooth App Shell fallback
 */

const CACHE_NAME = 'yomikomi-app-shell-v9';

// Static App Shell assets required to render the application offline
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/offline-manager.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/dexie@latest/dist/dexie.js'
];

// Install: Cache App Shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Add each asset individually so a single network glitch on a CDN doesn't fail the whole install
      return Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[Yomikomi SW] Failed to pre-cache:', asset, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: Prune stale caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Yomikomi SW] Pruning old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Smart network-first caching strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET requests and non-http(s) schemes (e.g. chrome-extension://, blob:)
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // CRITICAL RULE: NEVER interfere with chapter image downloads, Dexie storage, or proxy images
  // These are client-side managed in IndexedDB via Dexie to avoid duplicating storage
  if (
    url.pathname.startsWith('/api/proxy/image') ||
    url.pathname.startsWith('/api/proxy-image') ||
    url.hostname.includes('mangadex.org') ||
    url.hostname.includes('mangadex.network') ||
    url.hostname.includes('bacakomik') ||
    url.pathname.includes('/proxy/')
  ) {
    return; // Pass through to browser network layer directly
  }

  // 1. Navigation requests (HTML document): Network-First with Cache Fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return networkRes;
        })
        .catch(async () => {
          // If network is offline, serve cached App Shell
          const cached = await caches.match(req);
          if (cached) return cached;
          const rootCached = await caches.match('/');
          if (rootCached) return rootCached;
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 2. Internal API requests (/api/...): Network-First, return graceful offline JSON if offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(async () => {
        return new Response(
          JSON.stringify({
            error: 'offline',
            message: 'Koneksi internet terputus. Mode offline aktif — Anda dapat membaca komik yang telah disimpan di Offline Library.'
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // 3. Static Assets (CSS, JS, Fonts, Icons, CDNs): Network-First with Cache Fallback
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response('Aset tidak tersedia secara offline', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
  );
});
