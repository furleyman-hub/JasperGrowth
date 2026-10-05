// Offline cache + reminder notifications.
// Bump CACHE when shipping changes so phones pick up the new files.
const CACHE = 'gh-tracker-v8';
const FILES = [
  './',
  'index.html',
  'style.css',
  'firebase-config.js',
  'schedule.js',
  'store.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up when online; fall back to cache offline.
// Only app files and the Firebase SDK are cached. Firestore/Auth traffic passes through untouched.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin && url.host !== 'www.gstatic.com') return;
  // 'no-cache' revalidates with the server, so a new version shows up on the next open
  // instead of after GitHub Pages' 10-minute browser cache expires.
  const req = url.origin === self.location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Reminders are sent by the GitHub Action as FCM data messages: { data: { title, body } }.
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { /* not JSON */ }
  const d = payload.data || payload.notification || {};
  e.waitUntil(
    self.registration.showNotification(d.title || 'Growth Tracker', {
      body: d.body || 'Time for tonight\'s dose.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: d.tag || 'dose-reminder',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
