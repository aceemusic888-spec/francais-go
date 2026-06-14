importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDGQMrwcY0L9nxXqJL8fB0PWDZGOz-DiMg",
  authDomain: "frenchgo.firebaseapp.com",
  projectId: "frenchgo",
  storageBucket: "frenchgo.firebasestorage.app",
  messagingSenderId: "798535705126",
  appId: "1:798535705126:web:fdf97a6f0c4b80379efce7"
});

const messaging = firebase.messaging();

// Background push notifications (app fermée / en arrière-plan)
messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'FrenchGo 🦊';
  const body  = (payload.notification && payload.notification.body)  || 'Temps de pratiquer le français !';
  return self.registration.showNotification(title, {
    body,
    icon:     '/icon-192.png',
    badge:    '/icon-192.png',
    tag:      'frenchgo-daily',
    renotify: true,
    data:     { url: '/' }
  });
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ── Cache strategy ────────────────────────────────────────
const CACHE_NAME = 'frenchgo-v6.3';
const TTS_CACHE  = 'frenchgo-tts-v1';   // TTS audio — cache séparé, survit aux mises à jour app
const ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/mascot.png',
  '/mascot-hero.png'
];

const BYPASS = [
  'firebaseapp.com','googleapis.com','accounts.google.com',
  'gstatic.com/firebasejs','__/auth','identitytoolkit','securetoken',
  'fcm.googleapis.com'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== TTS_CACHE)
      .map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (BYPASS.some(b => url.includes(b))) return;

  // ── TTS API — Cache-First dans un cache séparé longue durée ──
  if (url.includes('/api/tts')) {
    e.respondWith(
      caches.open(TTS_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          if (cached) return cached;
          return fetch(e.request).then(function(res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          }).catch(function() { return new Response('{"error":"offline"}',
            { status: 503, headers: { 'Content-Type': 'application/json' } }); });
        });
      })
    );
    return;
  }

  const isHTML = e.request.mode === 'navigate' || e.request.destination === 'document'
    || url.endsWith('/') || url.endsWith('/index.html');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
