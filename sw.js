// ── ZenBTW Service Worker ─────────────────────────────────────────────────
// Cached shell voor offline gebruik + snelle herhaalde loads
// ─────────────────────────────────────────────────────────────────────────

const CACHE = 'zenbtw-v1';

const SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/js/products.js',
  '/js/marge.js',
  '/logo.webp',
];

// ── Install: cache de app shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: verwijder oude caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first voor shell, network-first voor de rest ──
self.addEventListener('fetch', e => {
  // Sla niet-GET requests over
  if (e.request.method !== 'GET') return;

  // Externe requests (fonts, analytics) altijd via netwerk
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Geef cached versie terug, update op de achtergrond
        const fetchPromise = fetch(e.request).then(fresh => {
          caches.open(CACHE).then(c => c.put(e.request, fresh.clone()));
          return fresh;
        }).catch(() => cached);
        return cached;
      }
      // Niet in cache: via netwerk, sla op voor volgende keer
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
