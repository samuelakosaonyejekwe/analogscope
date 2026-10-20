// Data access layer. Every request goes straight from the visitor's browser to
// the agency's public API: no keys, servers or backend of our own.
// Results are cached locally so the app keeps working offline.

import { remsClimatology } from './mars.js';

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

// Bump when the shape or meaning of cached location profiles changes.
export const PROFILE_KEY = (lat, lon) => `p2:${lat.toFixed(2)},${lon.toFixed(2)}`;

const store = {
  get(k) { try { const v = localStorage.getItem('as:' + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) {
    try { localStorage.setItem('as:' + k, JSON.stringify(v)); }
    catch {
      // Quota reached: drop the oldest cached profiles and retry once.
      try {
        const keys = Object.keys(localStorage).filter(x => /^as:(p\d*|r):/.test(x));
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(x => localStorage.removeItem(x));
        localStorage.setItem('as:' + k, JSON.stringify(v));
      } catch { /* storage unavailable */ }
    }
  },
};
export { store };

// Drop location profiles cached by earlier versions (unversioned "p:" keys).
try { Object.keys(localStorage).filter(k => k.startsWith('as:p:')).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }

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

/**
 * Elevation, relief and slope around a point. Pixels are addressed globally so the
 * sampling window can span neighbouring tiles. Web Mercator tiles stop at ±85.05°.
 */
export async function terrainAt(lat, lon, z = 10, win = 10) {
  if (Math.abs(lat) > 85) throw new Error('outside terrain tile coverage');
  const n = 2 ** z, { x, y } = tileXY(lat, lon, z);
  const gx = Math.floor(x * 256), gy = Math.floor(y * 256), reach = Math.max(win, 4);
  const tiles = new Map();
  const need = [];
  for (const ty of new Set([gy - reach, gy + reach].map(v => Math.floor(v / 256))))
    for (const tx of new Set([gx - reach, gx + reach].map(v => Math.floor(v / 256))))
      if (ty >= 0 && ty < n) need.push([((tx % n) + n) % n, ty]);
  await Promise.all(need.map(async ([tx, ty]) => tiles.set(`${tx},${ty}`, await terrainTile(z, tx, ty))));
  const at = (i, j) => {
    j = Math.max(0, Math.min(n * 256 - 1, j));
    const tx = ((Math.floor(i / 256) % n) + n) % n, ty = Math.floor(j / 256);
    const t = tiles.get(`${tx},${ty}`);
    return t ? t[(j - ty * 256) * 256 + (((i % 256) + 256) % 256)] : NaN;
  };
  const cell = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * n);
  let lo = Infinity, hi = -Infinity, slopeSum = 0, k = 0;
  for (let j = gy - win; j <= gy + win; j++) for (let i = gx - win; i <= gx + win; i++) {
    const v = at(i, j); if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let j = gy - 3; j <= gy + 3; j++) for (let i = gx - 3; i <= gx + 3; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    if (isFinite(dx) && isFinite(dy)) { slopeSum += Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI; k++; }
  }
  return { ELEV: round(at(gx, gy), 0), RELIEF: isFinite(hi - lo) ? round(hi - lo, 0) : null, SLOPE: k ? round(slopeSum / k, 1) : null };
}

// ---------- JAXA Earth API (GCOM-C, GCOM-W, MODIS normals; ESA/C3S land cover) ----------
let jeLib = null;
const loadJaxa = () => (jeLib ??= import(JAXA_LIB).catch(e => { jeLib = null; throw e; }));

// JAXA layers are monthly normals. Annual values are the mean of four seasonal
// months so they match NASA POWER's annual normals and do not depend on when the
// data were fetched.
export const SEASON_MONTHS = [0, 3, 6, 9];

async function jaxaGrid(key, box, w, h, month) {
  // The JAXA library fails noisily without a network, so skip it when offline.
  if (!navigator.onLine) throw new Error('offline');
  const je = await loadJaxa();
  const d = JAXA[key];
  const date = d.year ? new Date(Date.UTC(d.year, 0, 1)) : new Date(Date.UTC(2020, month, 1));
  // An explicit colour range only affects rendering (raw values are returned) and stops
  // the library logging errors when a raster is uniform or empty.
  const img = await je.getImage({ collection: d.url, band: d.band, date, bbox: [box.w, box.s, box.e, box.n], width: w, height: h, colorMap: { min: 0, max: 1 } });
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

const mean = a => { const v = a.filter(x => x != null && isFinite(x)); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };

/**
 * Combine per-season samples into annual values. `seasons[k]` holds the value of
 * layer k for each season month (null where the sensor has no data, e.g. polar night).
 * The ground swing uses only seasons where both day and night were observed.
 */
function annualJaxa(ndvi, lstd, lstn, smc, lc) {
  const pairs = lstd.map((d, i) => (d != null && lstn[i] != null ? d - lstn[i] : null));
  const D = mean(lstd), N = mean(lstn), lcv = lc == null || !isFinite(lc) ? null : Math.round(lc);
  return {
    NDVI: round(mean(ndvi), 3),
    LST_DAY: D == null ? null : round(D - 273.15, 1),
    LST_NIGHT: N == null ? null : round(N - 273.15, 1),
    LST_SWING: round(mean(pairs), 1),
    SOILM: round(mean(smc), 1),
    LC: lcv,
    BARREN: barrenness(lcv),
  };
}

/** A JAXA request, retried once. A failed request (network or service error) is
 *  different from a successful one that has no data (polar night, water, ice). */
const jaxaTry = (k, box, w, h, m) => jaxaGrid(k, box, w, h, m).catch(() => new Promise(r => setTimeout(r, 800)).then(() => jaxaGrid(k, box, w, h, m)));

/**
 * Point values from JAXA rasters: a 3x3 sample over ~0.1° for each season month.
 * Every season must be fetched successfully; otherwise the annual means would quietly
 * depend on which requests failed, so the whole set is rejected and the caller keeps
 * its previous values.
 */
export async function jaxaPoint(lat, lon) {
  const d = 0.05, box = { w: lon - d, e: lon + d, s: lat - d, n: lat + d };
  const get = (k, m) => jaxaTry(k, box, 3, 3, m).then(r => median(Array.from(r.data)));
  const seasonal = k => Promise.all(SEASON_MONTHS.map(m => get(k, m)));
  const [ndvi, lstd, lstn, smc, lcArr] = await Promise.all([
    seasonal('NDVI'), seasonal('LSTD'), seasonal('LSTN'), seasonal('SOILM'),
    jaxaTry('LC', box, 3, 3, 0).then(r => Array.from(r.data)),
  ]);
  const centre = isFinite(lcArr[4]) ? lcArr[4] : median(lcArr);
  return annualJaxa(ndvi, lstd, lstn, smc, centre);
}

/** Annual rasters over a scan box, w x h pixels, row 0 = north. */
export async function jaxaRegion(box, w, h) {
  const layers = ['NDVI', 'LSTD', 'LSTN', 'SOILM'];
  // Scans are exploratory: a layer that still fails after a retry is left out (null).
  const grid = (k, m) => jaxaTry(k, box, w, h, m).then(r => r.data).catch(() => null);
  const [seasonal, lc] = await Promise.all([
    Promise.all(layers.map(k => Promise.all(SEASON_MONTHS.map(m => grid(k, m))))),
    grid('LC', 0),
  ]);
  if (!seasonal.flat().some(Boolean) && !lc) return null;
  const at = (arr, i) => (arr && arr[i] != null && isFinite(arr[i]) ? arr[i] : null);
  const out = { NDVI: [], LST_DAY: [], LST_NIGHT: [], LST_SWING: [], SOILM: [], LC: [], BARREN: [] };
  for (let i = 0; i < w * h; i++) {
    const v = annualJaxa(...seasonal.map(ms => ms.map(a => at(a, i))), at(lc, i));
    for (const k in out) out[k].push(v[k]);
  }
  return out;
}

// ---------- Full profile of a location ----------
const POWER_VARS = ['T2M', 'T2M_RANGE', 'PRECIP', 'RH2M', 'UV', 'SOLAR', 'PS', 'CLOUD', 'WIND'];
const TERRAIN_VARS = ['ELEV', 'RELIEF', 'SLOPE'];
const JAXA_VARS = ['NDVI', 'LST_DAY', 'LST_NIGHT', 'LST_SWING', 'SOILM', 'LC', 'BARREN'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k] ?? null]));

/**
 * Full profile of a location. `fallback` (a cached or bundled profile) supplies the
 * values of any source that fails this time, so a partial outage never blanks data
 * that was already known.
 */
export async function profile(lat, lon, { useCache = true, fallback = null } = {}) {
  const key = PROFILE_KEY(lat, lon);
  const k = memo.get(key) || (useCache && store.get(key));
  if (k && Date.now() - k.t < 30 * 864e5) return k;
  const prev = k || fallback;
  const [clim, terr, jx] = await Promise.allSettled([powerClimatology(lat, lon), terrainAt(lat, lon), jaxaPoint(lat, lon)]);
  if (clim.status === 'rejected' && terr.status === 'rejected' && jx.status === 'rejected') {
    if (prev) return prev;
    throw new Error('No data reachable for this point (offline?)');
  }
  const ok = { power: clim.status === 'fulfilled', terrain: terr.status === 'fulfilled', jaxa: jx.status === 'fulfilled' };
  const p = {
    lat, lon, t: Date.now(),
    ann: {
      ...(ok.power ? pick(clim.value.ann, POWER_VARS) : pick(prev?.ann, POWER_VARS)),
      ...(ok.terrain ? pick(terr.value, TERRAIN_VARS) : pick(prev?.ann, TERRAIN_VARS)),
      ...(ok.jaxa ? pick(jx.value, JAXA_VARS) : pick(prev?.ann, JAXA_VARS)),
      ABSLAT: round(Math.abs(lat), 1),
    },
    months: ok.power ? clim.value.months : prev?.months || null,
    sources: ok,
  };
  // Only cache complete refreshes; partial ones are retried next time.
  if (ok.power && ok.terrain && ok.jaxa) { memo.set(key, p); store.set(key, p); }
  return p;
}

// ---------- Live feeds ----------
export const feeds = {
  eonet: () => getJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60&limit=400'),
  kp: () => getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
  xray: () => getJSON('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json'),
  quakes: () => getJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'),
  marsWeather: () => getJSON('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', { timeout: 30000 }),
  apod: key => nasaPicture(key),
  images: q => getJSON(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=12`),
};

// NASA picture of the day: the APOD API first (retried once, since the shared
// key is often busy), then NASA's Image of the Day feed as a fallback.
async function nasaPicture(key) {
  const apod = () => getJSON(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key || 'DEMO_KEY')}&thumbs=true`, { timeout: 12000 });
  try {
    const a = await apod().catch(() => new Promise(r => setTimeout(r, 1500)).then(apod));
    // Videos have no image unless the API supplies a thumbnail.
    const img = a.media_type === 'image' ? a.url : a.thumbnail_url || '';
    return { source: 'apod', title: a.title, date: a.date, url: img, hdurl: a.hdurl || img, media_type: a.media_type, copyright: a.copyright, link: `https://apod.nasa.gov/apod/ap${a.date.slice(2).replace(/-/g, '')}.html` };
  } catch {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch('https://www.nasa.gov/feeds/iotd-feed/', { mode: 'cors', credentials: 'omit', signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
      const it = doc.querySelector('item');
      if (!it) throw new Error('empty feed');
      const g = sel => it.querySelector(sel)?.textContent?.trim() || '';
      const img = it.querySelector('enclosure')?.getAttribute('url') || '';
      const d = new Date(g('pubDate'));
      return { source: 'iotd', title: g('title'), date: isNaN(d) ? '' : d.toISOString().slice(0, 10), url: img, hdurl: img, media_type: 'image', link: g('link'), description: g('description') };
    } finally { clearTimeout(t); }
  }
}

/** Cached wrapper for live feeds: try the network first, fall back to the last copy we saved. */
export async function live(name, arg, maxAgeMs = 0) {
  const k = 'f:' + name + (arg ? ':' + arg : '');
  const c = store.get(k);
  // A recent copy counts as live while online; offline it is labelled as a saved copy.
  if (c && ((maxAgeMs && Date.now() - c.t < maxAgeMs) || !navigator.onLine)) return { data: c.data, t: c.t, cached: !navigator.onLine };
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
  if (name === 'marsWeather') return { soles: (d.soles || []).slice(0, 60), clim: remsClimatology(d.soles || []) };
  if (name === 'eonet') return { events: (d.events || []).map(e => ({ id: e.id, title: e.title, cat: e.categories?.[0]?.id, catTitle: e.categories?.[0]?.title, link: e.sources?.[0]?.url || e.link, g: (e.geometry || []).slice(-1).map(g => ({ date: g.date, type: 'Point', c: g.type === 'Point' ? g.coordinates : centroid(g.coordinates), mag: g.magnitudeValue, unit: g.magnitudeUnit }))[0] })).filter(e => e.g && e.g.c) };
  if (name === 'kp') {
    // SWPC has published this as an array of objects and, earlier, as rows with a header row.
    const rows = Array.isArray(d[0]) ? d.slice(1).map(r => [r[0], +r[1]]) : d.map(r => [r.time_tag, +r.Kp]);
    return rows.filter(r => isFinite(r[1]));
  }
  if (name === 'quakes') return { features: (d.features || []).map(f => ({ mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, c: f.geometry.coordinates })) };
  if (name === 'xray') {
    // 1-minute data for 24 h; keep every 5th point so the chart still spans the whole day.
    const e = d.filter(x => x.energy === '0.1-0.8nm' && x.flux > 0);
    return e.filter((_, i) => i % 5 === 0 || i === e.length - 1).map(x => ({ t: x.time_tag, f: x.flux }));
  }
  if (name === 'images') return { items: (d.collection?.items || []).slice(0, 12).map(i => ({ title: i.data?.[0]?.title, center: i.data?.[0]?.center, date: i.data?.[0]?.date_created, thumb: i.links?.find(l => l.rel === 'preview')?.href, id: i.data?.[0]?.nasa_id })) };
  return d;
}

function centroid(c) {
  // Polygon / MultiPolygon: average of the outer ring's vertices.
  let ring = c;
  while (Array.isArray(ring?.[0]?.[0])) ring = ring[0];
  if (!Array.isArray(ring) || !ring.length) return null;
  const n = ring.length;
  return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n];
}

export function haversine(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
