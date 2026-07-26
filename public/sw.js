// Shell-only service worker. Everything this app shows is live, so nothing
// from a data feed is ever cached — this exists to make cold starts instant
// and to survive the flaky signal on the coast, not to work offline.
//
// Bump VERSION whenever a shell file changes; old caches are dropped on
// activate. Relative URLs resolve against this script, so the same file works
// at the site root (Netlify) and under /proxyme/ (GitHub Pages).
const VERSION = 'v2';
const SHELL = `proxme-shell-${VERSION}`;
const RUNTIME = `proxme-runtime-${VERSION}`;

// Must all fetch successfully or the install fails — same-origin only.
const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './overlays.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Immutable versioned CDN bundles — best-effort, never block the install.
const VENDOR = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Hosts whose responses must always come from the network.
const isLive = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/.netlify/') ||
  url.origin !== self.location.origin;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(CORE);
    await Promise.allSettled(VENDOR.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    await Promise.all(
      (await caches.keys()).filter((k) => !keep.has(k)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Vendor bundles are version-pinned: cache-first, forever.
  if (VENDOR.includes(url.href)) {
    e.respondWith(caches.match(request).then((hit) => hit || fetchAndPut(request, SHELL)));
    return;
  }

  // Feeds, functions and every third-party API: network only, never stored.
  if (isLive(url)) return;

  // Navigations: network-first so a deploy lands immediately when online.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((r) => { put(SHELL, request, r.clone()); return r; })
        .catch(async () => (await caches.match(request)) || caches.match('./index.html'))
    );
    return;
  }

  // Static shell + the static harvests in data/: stale-while-revalidate.
  e.respondWith((async () => {
    const hit = await caches.match(request);
    const net = fetchAndPut(request, hit ? RUNTIME : SHELL).catch(() => null);
    return hit || (await net) || new Response('offline', { status: 503 });
  })());
});

async function fetchAndPut(request, cacheName) {
  const r = await fetch(request);
  put(cacheName, request, r.clone());
  return r;
}

function put(cacheName, request, response) {
  if (!response.ok || response.type === 'opaque') return;
  caches.open(cacheName).then((c) => c.put(request, response)).catch(() => {});
}
