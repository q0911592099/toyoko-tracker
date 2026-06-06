// sw.js
// Service Worker for Toyoko Tracker PWA

const CACHE_NAME = 'toyoko-tracker-v1.2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './config.js',
  './data.js',
  './hotels_db.js'
];

// Install Event
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event (Clean old caches)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Event (Network-First strategy falling back to cache)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Bypass service worker caching for API calls
  if (url.pathname.includes('/api/')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Cache successful responses of static files
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network is unavailable (offline)
        console.log('[Service Worker] Network request failed. Serving from cache:', e.request.url);
        return caches.match(e.request);
      })
  );
});
