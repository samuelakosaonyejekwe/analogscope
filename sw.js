// AnalogScope service worker: offline app shell, cached map tiles and the latest live data.
const VERSION = 'v1.0.0';
const SHELL = `as-shell-${VERSION}`;
const TILES = 'as-tiles-v1';
const DATA = 'as-data-v1';
const LIB = 'as-lib-v1';
const MAX_TILES = 3000;

const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/state.js', 'js/data.js', 'js/engine.js', 'js/targets.js', 'js/sites.js', 'js/scan.js',
  'js/charts.js', 'js/mapview.js', 'js/report.js', 'js/pages.js', 'js/install.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png', 'vendor/leaflet/images/marker-icon.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'data/snapshot.json',
];
const JAXA_LIB = 'https://data.earth.jaxa.jp/api/javascript/v1.2.3/jaxa.earth.esm.js';
const TILE_HOSTS = ['gibs.earthdata.nasa.gov', 'trek.nasa.gov', 'tiles.maps.eox.at', 's3.amazonaws.com'];
const DATA_HOSTS = ['power.larc.nasa.gov', 'eonet.gsfc.nasa.gov', 'services.swpc.noaa.gov', 'earthquake.usgs.gov', 'mars.nasa.gov', 'images-api.nasa.gov', 'api.nasa.gov'];
const FEEDS = [
  'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60&limit=400',
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
  'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(ASSETS);
    try { const l = await caches.open(LIB); if (!(await l.match(JAXA_LIB))) await l.add(new Request(JAXA_LIB, { mode: 'cors' })); } catch { /* fetched later */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('as-shell-') && k !== SHELL) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function withCacheFlag(res) {
  const h = new Headers(res.headers);
  h.set('x-as-cache', '1');
  return res.blob().then(b => new Response(b, { status: res.status, statusText: res.statusText, headers: h }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  // App shell: serve instantly from cache, refresh in the background.
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith((async () => {
        const cached = await caches.match('index.html');
        const net = (async () => {
          const pre = await e.preloadResponse;
          const r = pre || await fetch(req);
          if (r.ok) (await caches.open(SHELL)).put('index.html', r.clone());
          return r;
        })();
        e.waitUntil(net.catch(() => {}));
        return cached || net;
      })());
      return;
    }
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const net = fetch(req).then(async r => { if (r.ok) (await caches.open(SHELL)).put(req, r.clone()); return r; });
      e.waitUntil(net.catch(() => {}));
      return cached || net;
    })());
    return;
  }

  // JAXA client library: cache first.
  if (url.href === JAXA_LIB) {
    e.respondWith((async () => (await caches.match(req)) || fetch(req).then(async r => { if (r.ok) (await caches.open(LIB)).put(req, r.clone()); return r; }))());
    return;
  }

  // Map and terrain tiles: cache first, bounded size.
  if (TILE_HOSTS.includes(url.hostname) && !url.pathname.endsWith('.json')) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.type !== 'opaque') { c.put(req, r.clone()); if (Math.random() < 0.02) e.waitUntil(trim(TILES, MAX_TILES)); }
      return r;
    })());
    return;
  }

  // Live data APIs: network first (fresh data), last good copy when offline.
  if (DATA_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(DATA);
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        const hit = await c.match(req);
        if (hit) return withCacheFlag(hit);
        throw err;
      }
    })());
  }
});

// Refresh live feeds in the background on browsers that support it.
async function refreshFeeds() {
  const c = await caches.open(DATA);
  await Promise.allSettled(FEEDS.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r))));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'refresh-live') e.waitUntil(refreshFeeds()); });
self.addEventListener('sync', e => { if (e.tag === 'refresh-live') e.waitUntil(refreshFeeds()); });
self.addEventListener('message', e => { if (e.data === 'refresh-live') e.waitUntil?.(refreshFeeds()); });
