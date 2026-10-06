// Service Worker for Mostla Showroom Admin PWA
// Provides network-first caching so live Socket.IO and API interactions are always up-to-date.

const CACHE_NAME = 'mostla-admin-v1';
const STATIC_ASSETS = [
  '/admin.html',
  '/css/admin.css',
  '/js/admin.js',
  '/manifest.json',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Failed to pre-cache some assets during install:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept Socket.IO polling/websockets or API mutation calls
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy: always fetch fresh from server, fallback to cache if disconnected
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
