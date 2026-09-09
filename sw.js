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
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'frenchgo-daily',
    renotify: true,
    data: { url: '/' }
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
const CACHE_NAME = 'frenchgo-v22';
const TTS_CACHE  = 'frenchgo-tts-v1'; // TTS audio — cache séparé, survit aux mises à jour app
// La coquille de l'app EN PREMIER : sans elle en cache, un démarrage réseau lent
// n'a aucun repli et l'app reste bloquée sur le splash.
const SHELL  = '/index.html';
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
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 1) La page elle-même, sous les DEUX clés possibles ('/' = start_url du manifeste,
    //    '/index.html' = repli). C'est ce qui garantit un démarrage même hors ligne.
    try {
      const res = await fetch(SHELL, { cache: 'reload' });
      if (res && res.ok) {
        await cache.put(SHELL, res.clone());
        await cache.put('/', res.clone());
      }
    } catch (_e) { /* pas de réseau à l'install : on réessaiera au premier fetch */ }
    // 2) Les assets, un par un : un fichier manquant ne doit PAS faire échouer
    //    l'installation entière (addAll est tout-ou-rien).
    await Promise.all(ASSETS.map(u =>
      cache.add(u).catch(() => {})
    ));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== TTS_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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
    // Network-first avec repli cache. RÈGLE ABSOLUE : on ne renvoie JAMAIS d'erreur
    // tant qu'il reste une piste. Sans copie en cache, on attend le réseau
    // aussi longtemps qu'il faut — mieux vaut un démarrage lent qu'un écran bloqué.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // ignoreSearch : '/?v=17' et '/?tab=lessons' doivent retrouver la page cachée sous '/'
      const cached = await cache.match(e.request, { ignoreSearch: true })
                  || await cache.match(SHELL)
                  || await cache.match('/');

      const network = fetch(e.request).then(res => {
        if (res && res.ok) {
          const c = res.clone();
          cache.put(e.request, c.clone()).catch(() => {});
          cache.put(SHELL, c.clone()).catch(() => {});
          cache.put('/', c).catch(() => {});
        }
        return res;
      });

      // Pas de copie en cache → on n'a pas le choix, on attend vraiment le réseau.
      if (!cached) {
        try { return await network; }
        catch (_e) { return new Response('Offline', { status: 503 }); }
      }

      // Copie en cache disponible → on laisse 6 s au réseau, sinon on sert le cache
      // et on rafraîchit en arrière-plan pour le prochain lancement.
      try {
        return await Promise.race([
          network,
          new Promise((_, rj) => setTimeout(() => rj(new Error('sw-timeout')), 6000))
        ]);
      } catch (_err) {
        network.catch(() => {}); // continue en arrière-plan, met le cache à jour
        return cached;
      }
    })());
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
