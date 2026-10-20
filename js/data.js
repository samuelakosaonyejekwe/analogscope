// Data access layer. Every request goes straight from the visitor's browser to
// the agency's public API: no keys, servers or backend of our own.
// Results are cached locally so the app keeps working offline.

const POWER = 'https://power.larc.nasa.gov/api/temporal';
const POWER_PARAMS = ['T2M', 'T2M_RANGE', 'PRECTOTCORR', 'RH2M', 'ALLSKY_SFC_UV_INDEX', 'ALLSKY_SFC_SW_DWN', 'PS', 'CLOUD_AMT', 'WS2M'];
const POWER_KEY = { T2M: 'T2M', T2M_RANGE: 'T2M_RANGE', PRECTOTCORR: 'PRECIP', RH2M: 'RH2M', ALLSKY_SFC_UV_INDEX: 'UV', ALLSKY_SFC_SW_DWN: 'SOLAR', PS: 'PS', CLOUD_AMT: 'CLOUD', WS2M: 'WIND' };
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const JAXA_LIB = 'https://data.earth.jaxa.jp/api/javascript/v1.2.3/jaxa.earth.esm.js';
const WAS = 'https://s3.ap-northeast-1.wasabisys.com/';
const JAXA = {
  NDVI:   { url: WAS + 'je-pds/cog/v1/JAXA.JASMES_Terra.MODIS-Aqua.MODIS_ndvi.v811_global_monthly-normal/collection.json', band: 'ndvi_2012_2021' },
  LSTD:   { url: WAS + 'je-pds2/cog/v1/JAXA.JASMES_GCOM-C.SGLI_standard.L3-LST.daytime.v3_global_monthly-normal/collection.json', band: 'LST_2000_2022' },
  LSTN:   { url: WAS + 'je-pds2/cog/v1/JAXA.JASMES_GCOM-C.SGLI_standard.L3-LST.nighttime.v3_global_monthly-normal/collection.json', band: 'LST_2000_2022' },
  SOILM:  { url: WAS + 'je-pds/cog/v1/JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SMC.daytime.v3_global_monthly-normal/collection.json', band: 'SMC_2012_2021' },
  LC:     { url: WAS + 'je-pds/cog/v1/Copernicus.C3S_PROBA-V_LCCS_global_yearly/collection.json', band: 'LCCS', year: 2019 },
};

// ---------- small utilities ----------
const memo = new Map();

export async function getJSON(url, { timeout = 20000, signal } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch(url, { signal: ctl.signal, mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    // The service worker marks responses it served from its offline cache.
    if (r.headers.get('x-as-cache') && j && typeof j === 'object') Object.defineProperty(j, '__cachedAt', { value: Date.parse(r.headers.get('date')) || 0 });
    return j;
  } finally { clearTimeout(t); }
}

const store = {
  get(k) { try { const v = localStorage.getItem('as:' + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) {
    try { localStorage.setItem('as:' + k, JSON.stringify(v)); }
    catch {
      // Quota reached: drop the oldest cached profiles and retry once.
      try {
        const keys = Object.keys(localStorage).filter(x => x.startsWith('as:p:'));
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(x => localStorage.removeItem(x));
        localStorage.setItem('as:' + k, JSON.stringify(v));
      } catch { /* storage unavailable */ }
    }
  },
};
export { store };

const num = v => (typeof v === 'number' && isFinite(v) && v > -998 ? v : null);
export const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------- NASA POWER climatology (2001–2020 normals) ----------
export async function powerClimatology(lat, lon) {
  const url = `${POWER}/climatology/point?parameters=${POWER_PARAMS.join(',')}&community=RE&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&format=JSON`;
  const j = await getJSON(url, { timeout: 25000 });
  const p = j.properties.parameter;
  const ann = {}, months = {};
  for (const [src, key] of Object.entries(POWER_KEY)) {
    const s = p[src]; if (!s) continue;
    const f = key === 'PRECIP' ? 365 : 1; // mm/day -> mm/yr
    ann[key] = round(num(s.ANN) == null ? null : s.ANN * f, 2);
    months[key] = MONTHS.map(m => round(num(s[m]) == null ? null : s[m] * f, 2));
  }
  return { ann, months, gridElev: j.geometry?.coordinates?.[2] ?? null };
}

// ---------- NASA POWER daily: the last ~6 weeks at a point ----------
export async function powerRecent(lat, lon, days = 45) {
  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  const f = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const params = ['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M', 'ALLSKY_SFC_UV_INDEX', 'ALLSKY_SFC_SW_DWN', 'WS2M', 'CLOUD_AMT', 'PS'];
  const url = `${POWER}/daily/point?parameters=${params.join(',')}&community=RE&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start=${f(start)}&end=${f(end)}&format=JSON`;
  const j = await getJSON(url, { timeout: 25000 });
  const p = j.properties.parameter;
  const dates = Object.keys(p.T2M);
  const series = {};
  for (const k of params) series[k] = dates.map(d => num(p[k]?.[d]));
  // trim trailing days that NASA has not processed yet
  let last = dates.length - 1;
  while (last > 0 && series.T2M[last] == null) last--;
  for (const k of params) series[k] = series[k].slice(0, last + 1);
  return { dates: dates.slice(0, last + 1), series };
}

// ---------- NASA POWER regional grid (one parameter per call) ----------
export async function powerRegional(param, box, signal) {
  const url = `${POWER}/climatology/regional?parameters=${param}&community=RE&latitude-min=${box.s}&latitude-max=${box.n}&longitude-min=${box.w}&longitude-max=${box.e}&format=JSON`;
  const j = await getJSON(url, { timeout: 45000, signal });
  return j.features.map(f => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], ann: num(f.properties.parameter[param].ANN) }));
}

// ---------- Terrain from SRTM-derived Terrarium tiles ----------
const tileCache = new Map();
function tileXY(lat, lon, z) {
  const n = 2 ** z, x = (lon + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x, y };
}
async function terrainTile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (tileCache.has(k)) return tileCache.get(k);
  const p = (async () => {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`, { mode: 'cors' });
    if (!r.ok) throw new Error('terrain ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data;
    const e = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    return e;
  })();
  tileCache.set(k, p);
  if (tileCache.size > 80) tileCache.delete(tileCache.keys().next().value);
  p.catch(() => tileCache.delete(k));
  return p;
}

export async function terrainAt(lat, lon, z = 10, win = 10) {
  const { x, y } = tileXY(lat, lon, z);
  const tx = Math.floor(x), ty = Math.floor(y);
  const e = await terrainTile(z, tx, ty);
  const px = Math.min(255, Math.floor((x - tx) * 256)), py = Math.min(255, Math.floor((y - ty) * 256));
  const at = (i, j) => e[Math.max(0, Math.min(255, j)) * 256 + Math.max(0, Math.min(255, i))];
  const cell = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** z);
  let lo = Infinity, hi = -Infinity, slopeSum = 0, n = 0;
  for (let j = py - win; j <= py + win; j++) for (let i = px - win; i <= px + win; i++) {
    const v = at(i, j); if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let j = py - 3; j <= py + 3; j++) for (let i = px - 3; i <= px + 3; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    slopeSum += Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI; n++;
  }
  return { ELEV: round(at(px, py), 0), RELIEF: round(hi - lo, 0), SLOPE: round(slopeSum / n, 1) };
}

// ---------- JAXA Earth API (GCOM-C, GCOM-W, MODIS normals; ESA/C3S land cover) ----------
let jeLib = null;
const loadJaxa = () => (jeLib ??= import(JAXA_LIB).catch(e => { jeLib = null; throw e; }));

async function jaxaGrid(key, box, w, h, month) {
  // The JAXA library fails noisily without a network, so skip it when offline.
  if (!navigator.onLine) throw new Error('offline');
  const je = await loadJaxa();
  const d = JAXA[key];
  const date = d.year ? new Date(Date.UTC(d.year, 0, 1)) : new Date(Date.UTC(2020, month, 1));
  const img = await je.getImage({ collection: d.url, band: d.band, date, bbox: [box.w, box.s, box.e, box.n], width: w, height: h });
  return img.getData();
}

/** Bare ground scores 1 and dense vegetation, crops, cities and water score 0 (ESA CCI / C3S LCCS classes). */
export function barrenness(lc) {
  if (lc == null || !isFinite(lc)) return null;
  if (lc >= 200 && lc <= 202) return 1;      // bare areas
  if (lc === 220) return 1;                   // permanent snow & ice
  if (lc >= 150 && lc <= 153) return 0.75;    // sparse vegetation
  if (lc === 140) return 0.65;                // lichens & mosses
  if (lc >= 120 && lc <= 122) return 0.4;     // shrubland
  if (lc === 130) return 0.3;                 // grassland
  if (lc === 110 || lc === 100) return 0.25;
  return 0;
}
export const LC_NAMES = { 10: 'Cropland', 11: 'Cropland', 12: 'Cropland', 20: 'Irrigated cropland', 30: 'Crop/vegetation mosaic', 40: 'Vegetation/crop mosaic', 50: 'Broadleaf forest', 60: 'Deciduous forest', 61: 'Deciduous forest', 62: 'Deciduous forest', 70: 'Needleleaf forest', 71: 'Needleleaf forest', 80: 'Deciduous needleleaf', 90: 'Mixed forest', 100: 'Tree/shrub mosaic', 110: 'Herbaceous mosaic', 120: 'Shrubland', 121: 'Shrubland', 122: 'Shrubland', 130: 'Grassland', 140: 'Lichens & mosses', 150: 'Sparse vegetation', 151: 'Sparse trees', 152: 'Sparse shrubs', 153: 'Sparse herbs', 160: 'Flooded forest', 170: 'Saline flooded forest', 180: 'Flooded shrub', 190: 'Urban', 200: 'Bare ground', 201: 'Consolidated bare', 202: 'Unconsolidated bare', 210: 'Water', 220: 'Permanent snow & ice' };

const median = a => { const v = a.filter(x => x != null && isFinite(x)).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };

/** Point values from JAXA rasters, using a 3x3 sample over ~0.1° for stability. */
export async function jaxaPoint(lat, lon, month = new Date().getUTCMonth()) {
  const d = 0.05, box = { w: lon - d, e: lon + d, s: lat - d, n: lat + d };
  const get = k => jaxaGrid(k, box, 3, 3, month).then(r => Array.from(r.data)).catch(() => null);
  const [ndvi, lstd, lstn, smc, lc] = await Promise.all(['NDVI', 'LSTD', 'LSTN', 'SOILM', 'LC'].map(get));
  const D = median(lstd || []), N = median(lstn || []);
  const lcv = lc ? lc[4] ?? median(lc) : null;
  return {
    NDVI: round(median(ndvi || []), 3),
    LST_DAY: D == null ? null : round(D - 273.15, 1),
    LST_NIGHT: N == null ? null : round(N - 273.15, 1),
    LST_SWING: D == null || N == null ? null : round(D - N, 1),
    SOILM: round(median(smc || []), 1),
    LC: lcv == null || !isFinite(lcv) ? null : Math.round(lcv),
    BARREN: barrenness(lcv == null ? null : Math.round(lcv)),
    month,
  };
}

/** Rasters over a scan box, w x h pixels, row 0 = north. */
export async function jaxaRegion(box, w, h, month) {
  const keys = ['NDVI', 'LSTD', 'LSTN', 'SOILM', 'LC'];
  const res = await Promise.all(keys.map(k => jaxaGrid(k, box, w, h, month).then(r => r.data).catch(() => null)));
  return Object.fromEntries(keys.map((k, i) => [k, res[i]]));
}

// ---------- Full profile of a location ----------
export async function profile(lat, lon, { useCache = true } = {}) {
  const key = `p:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const k = memo.get(key) || (useCache && store.get(key));
  if (k && Date.now() - k.t < 30 * 864e5) return k;
  const [clim, terr, jx] = await Promise.allSettled([powerClimatology(lat, lon), terrainAt(lat, lon), jaxaPoint(lat, lon)]);
  if (clim.status === 'rejected' && terr.status === 'rejected' && jx.status === 'rejected') {
    if (k) return k;
    throw new Error('No data reachable for this point (offline?)');
  }
  const p = {
    lat, lon, t: Date.now(),
    ann: { ...(clim.value?.ann || {}), ...(terr.value || {}), ...(jx.value || {}), ABSLAT: round(Math.abs(lat), 1) },
    months: clim.value?.months || null,
    sources: { power: clim.status === 'fulfilled', terrain: terr.status === 'fulfilled', jaxa: jx.status === 'fulfilled' && jx.value.NDVI != null },
  };
  memo.set(key, p);
  store.set(key, p);
  return p;
}

// ---------- Live feeds ----------
export const feeds = {
  eonet: () => getJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60&limit=400'),
  kp: () => getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
  xray: () => getJSON('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json'),
  quakes: () => getJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'),
  marsWeather: () => getJSON('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', { timeout: 30000 }),
  apod: key => getJSON(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key || 'DEMO_KEY')}`),
  images: q => getJSON(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=12`),
};

/** Cached wrapper for live feeds: try the network first, fall back to the last copy we saved. */
export async function live(name, arg, maxAgeMs = 0) {
  const k = 'f:' + name + (arg ? ':' + arg : '');
  const c = store.get(k);
  if (c && maxAgeMs && Date.now() - c.t < maxAgeMs) return { data: c.data, t: c.t, cached: false };
  try {
    const data = await feeds[name](arg);
    const slim = slimFeed(name, data);
    if (data.__cachedAt !== undefined) {
      if (c && c.t >= data.__cachedAt) return { data: c.data, t: c.t, cached: true };
      return { data: slim, t: data.__cachedAt, cached: true };
    }
    store.set(k, { t: Date.now(), data: slim });
    return { data: slim, t: Date.now(), cached: false };
  } catch (e) {
    if (c) return { data: c.data, t: c.t, cached: true, error: e.message };
    throw e;
  }
}

// Keep only what the UI needs so offline copies stay small.
function slimFeed(name, d) {
  if (name === 'marsWeather') return { soles: (d.soles || []).slice(0, 60) };
  if (name === 'eonet') return { events: (d.events || []).map(e => ({ id: e.id, title: e.title, cat: e.categories?.[0]?.id, catTitle: e.categories?.[0]?.title, link: e.sources?.[0]?.url || e.link, g: (e.geometry || []).slice(-1).map(g => ({ date: g.date, type: g.type, c: g.coordinates, mag: g.magnitudeValue, unit: g.magnitudeUnit }))[0] })) };
  if (name === 'quakes') return { features: (d.features || []).map(f => ({ mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, c: f.geometry.coordinates })) };
  if (name === 'xray') return d.filter(x => x.energy === '0.1-0.8nm').slice(-288).map(x => ({ t: x.time_tag, f: x.flux }));
  if (name === 'images') return { items: (d.collection?.items || []).slice(0, 12).map(i => ({ title: i.data?.[0]?.title, center: i.data?.[0]?.center, date: i.data?.[0]?.date_created, thumb: i.links?.find(l => l.rel === 'preview')?.href, id: i.data?.[0]?.nasa_id })) };
  return d;
}

export function haversine(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
