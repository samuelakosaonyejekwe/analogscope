// AnalogScope service worker: offline app shell, cached map tiles and the latest live data.
const VERSION = 'v1.3.0';
// Shown in the "Update available" pop-up. Keep it short and user-facing.
const NOTES = [
  'Update pop-up: new versions now ask before reloading, and show what changed',
  'Install centre with steps for every phone, tablet and computer, plus a QR code',
  'Firefox can now install AnalogScope on Windows and Linux',
  '60 documented lava-tube caves with exact coordinates from Wikidata',
  'Live data refreshes in the background more reliably',
];
const SHELL = `as-shell-${VERSION}`;
const TILES = 'as-tiles-v1';
const DATA = 'as-data-v1';
const LIB = 'as-lib-v1';
const PACK = 'as-pack-v1';   // offline map pack saved from the Live page; never trimmed
const MAX_TILES = 3000;

const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/state.js', 'js/data.js', 'js/engine.js', 'js/targets.js', 'js/sites.js', 'js/scan.js',
  'js/charts.js', 'js/mapview.js', 'js/report.js', 'js/pages.js', 'js/install.js', 'js/updates.js', 'js/evidence.js', 'js/mars.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png', 'vendor/leaflet/images/marker-icon.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'data/snapshot.json', 'data/volcanoes.json', 'data/lavatubes.json', 'icons/favicon.ico', 'icons/qr.svg',
];
const JAXA_LIB = 'https://data.earth.jaxa.jp/api/javascript/v1.2.3/jaxa.earth.esm.js';
const TILE_HOSTS = ['gibs.earthdata.nasa.gov', 'trek.nasa.gov', 'tiles.maps.eox.at', 's3.amazonaws.com'];
const DATA_HOSTS = ['power.larc.nasa.gov', 'eonet.gsfc.nasa.gov', 'services.swpc.noaa.gov', 'earthquake.usgs.gov', 'mars.nasa.gov', 'images-api.nasa.gov', 'api.nasa.gov', 'www.nasa.gov'];
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
    // Bypass the HTTP cache so a new version never precaches stale copies.
    await c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    try { const l = await caches.open(LIB); if (!(await l.match(JAXA_LIB))) await l.add(new Request(JAXA_LIB, { mode: 'cors' })); } catch { /* fetched later */ }
    // First install: take over at once. Updates wait until the user accepts the
    // pop-up, except over versions released before the pop-up existed (≤ 1.2),
    // whose pages cannot show it.
    const legacy = (await caches.keys()).some(k => /^as-shell-v1\.[0-2]\./.test(k));
    if (!self.registration.active || legacy) await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, TILES, DATA, LIB, PACK]);
    for (const k of await caches.keys()) if (k.startsWith('as-') && !keep.has(k)) await caches.delete(k);
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
        const shell = await caches.open(SHELL);
        const cached = await shell.match('index.html');
        const net = (async () => {
          const pre = await e.preloadResponse;
          const r = pre || await fetch(req);
          if (r.ok) await shell.put('index.html', r.clone());
          return r;
        })();
        e.waitUntil(net.catch(() => {}));
        return cached || net;
      })());
      return;
    }
    e.respondWith((async () => {
      const shell = await caches.open(SHELL);
      const cached = await shell.match(req, { ignoreSearch: true });
      const net = fetch(req).then(async r => { if (r.ok) await shell.put(req, r.clone()); return r; });
      e.waitUntil(net.catch(() => {}));
      return cached || net;
    })());
    return;
  }

  // JAXA client library: cache first.
  if (url.href === JAXA_LIB) {
    e.respondWith((async () => {
      const lib = await caches.open(LIB);
      return (await lib.match(req)) || fetch(req).then(async r => { if (r.ok) await lib.put(req, r.clone()); return r; });
    })());
    return;
  }

  // Map and terrain tiles: cache first, bounded size.
  if (TILE_HOSTS.includes(url.hostname) && !url.pathname.endsWith('.json')) {
    e.respondWith((async () => {
      const hit = (await (await caches.open(PACK)).match(req)) || (await (await caches.open(TILES)).match(req));
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.type !== 'opaque') {
        const copy = r.clone();
        e.waitUntil(caches.open(TILES).then(c => c.put(req, copy)).then(() => (Math.random() < 0.02 ? trim(TILES, MAX_TILES) : null)));
      }
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
        if (r.ok) { const copy = r.clone(); e.waitUntil(c.put(req, copy)); }
        return r;
      } catch (err) {
        const hit = await c.match(req);
        if (hit) return withCacheFlag(hit);
        throw err;
      }
    })());
  }
});

// Refresh live feeds in the background where Periodic Background Sync is available
// (installed Chromium apps); other browsers refresh whenever the app is opened.
async function refreshFeeds() {
  const c = await caches.open(DATA);
  // no-store: go to the agency, not the browser's HTTP cache, so the copy is really new.
  await Promise.allSettled(FEEDS.map(u => fetch(u, { mode: 'cors', cache: 'no-store' }).then(r => r.ok && c.put(u, r))));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'refresh-live') e.waitUntil(refreshFeeds()); });

// The app asks for a refresh each time it starts, so offline copies are current in
// every browser, not only where Periodic Background Sync exists.
self.addEventListener('message', e => {
  if (e.data === 'refresh-live') e.waitUntil(refreshFeeds());
  else if (e.data === 'skip-waiting') self.skipWaiting();
  else if (e.data === 'info') e.ports[0]?.postMessage({ version: VERSION, notes: NOTES });
});

// Offline map pack: the page sends the tile list; the worker downloads it straight into
// the pack cache (its own fetches skip the tile handler, so nothing is stored twice)
// and reports progress back to the page.
self.addEventListener('message', e => {
  if (e.data?.type !== 'pack' || !Array.isArray(e.data.urls)) return;
  const urls = e.data.urls.filter(u => TILE_HOSTS.includes(new URL(u).hostname));
  const port = e.ports[0];
  e.waitUntil((async () => {
    const pack = await caches.open(PACK);
    let done = 0, ok = 0, bytes = 0, i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try {
          if (await pack.match(u)) ok++;
          else {
            const r = await fetch(u, { mode: 'cors' });
            if (r.ok) { const b = await r.clone().blob(); bytes += b.size; await pack.put(u, r); ok++; }
          }
        } catch { /* skip tile */ }
        done++;
        if (done % 10 === 0 || done === urls.length) port?.postMessage({ done, total: urls.length, ok, bytes });
      }
    }));
    port?.postMessage({ done: urls.length, total: urls.length, ok, bytes, finished: true });
  })());
});
