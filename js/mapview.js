// Explore map: base layers, analog site markers, live events and the discovery scan.
import { state, set, target, siteProfile, toast, scoreColor, fmt, mark } from './state.js';
import { SITES } from './sites.js';
import { TARGETS, MISSIONS } from './targets.js';
import { evaluate } from './engine.js';
import { live } from './data.js';
import { scan, scanBox } from './scan.js';
import { esc } from './charts.js';

const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
export const LAYERS = {
  bluemarble: { label: 'NASA Blue Marble (relief)', url: GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg', max: 8, attr: 'NASA GIBS / Blue Marble' },
  s2: { label: 'ESA Sentinel-2 cloudless', url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', max: 15, attr: 'Sentinel-2 cloudless 2021 by EOX (Copernicus Sentinel data 2021)' },
  viirs: { label: 'NASA VIIRS – yesterday', url: () => GIBS + `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, max: 9, attr: 'NASA GIBS / Suomi NPP VIIRS', live: true },
  modis: { label: 'NASA MODIS Terra – yesterday', url: () => GIBS + `MODIS_Terra_CorrectedReflectance_TrueColor/default/${yesterday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, max: 9, attr: 'NASA GIBS / Terra MODIS', live: true },
  lst: { label: 'NASA land surface temp. (day)', url: () => GIBS + `MODIS_Terra_Land_Surface_Temp_Day/default/${new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, max: 7, attr: 'NASA GIBS / Terra MODIS LST', live: true, under: 'bluemarble' },
  relief: { label: 'NASA ASTER GDEM relief', url: GIBS + 'ASTER_GDEM_Greyscale_Shaded_Relief/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg', max: 12, attr: 'NASA/METI ASTER GDEM via GIBS' },
};

let map, base, under, siteLayer, eventLayer, heatLayer, candLayer, pointMarker;
let onSelect = () => {};
const markers = new Map();

function tile(def) {
  const url = typeof def.url === 'function' ? def.url() : def.url;
  return L.tileLayer(url, { maxNativeZoom: def.max, maxZoom: 16, attribution: def.attr, crossOrigin: true, keepBuffer: 1, updateWhenIdle: true, bounds: [[-85.05, -180], [85.05, 180]] });
}

export function setBase(id) {
  const def = LAYERS[id] || LAYERS.bluemarble;
  if (base) map.removeLayer(base);
  if (under) { map.removeLayer(under); under = null; }
  if (def.under) { under = tile(LAYERS[def.under]).addTo(map); under.bringToBack(); }
  base = tile(def).addTo(map);
  if (def.under) base.setOpacity(0.8);
  base.on('tileerror', () => mark('NASA GIBS / ESA tiles', false));
  base.on('tileload', () => mark('NASA GIBS / ESA tiles', true));
}

export function initMap(el, select) {
  onSelect = select;
  map = L.map(el, { zoomControl: true, worldCopyJump: true, minZoom: 2, maxBounds: [[-88, -540], [88, 540]], preferCanvas: true, attributionControl: true }).setView([20, 0], 2);
  map.attributionControl.setPrefix(false);
  setBase(state.layer);
  siteLayer = L.layerGroup().addTo(map);
  eventLayer = L.layerGroup();
  heatLayer = L.layerGroup().addTo(map);
  candLayer = L.layerGroup().addTo(map);
  L.control.layers(null, { 'Analog sites': siteLayer, 'Live natural events (NASA EONET)': eventLayer, 'Discovery heatmap': heatLayer, 'My saved candidates': candLayer }, { position: 'topright', collapsed: true }).addTo(map);
  L.control.scale({ imperial: false, position: 'topright' }).addTo(map);

  map.on('click', e => {
    const lat = +e.latlng.lat.toFixed(3), lon = +(((e.latlng.lng + 540) % 360) - 180).toFixed(3);
    onSelect({ kind: 'point', lat, lon });
  });
  map.on('overlayadd', e => { if (e.layer === eventLayer) loadEvents(); });
  drawSites();
  drawCandidates();
  legend();
  return map;
}

export const getMap = () => map;
export function invalidate() { map && setTimeout(() => map.invalidateSize(), 60); }

export function legend(extra = '') {
  const t = target();
  document.getElementById('legend').innerHTML = `<b>${esc(t.name)}</b> analog score<div class="bar"></div><div class="row"><span>0 poor</span><span>50</span><span>100 exceptional</span></div>${extra}<div class="muted" style="margin-top:4px">Tap anywhere on the map to score that spot.</div>`;
}

export function drawSites() {
  siteLayer.clearLayers(); markers.clear();
  const t = target();
  for (const s of SITES) {
    const p = siteProfile(s.id);
    const sc = p ? evaluate(t, p.ann, s.geo, state.mission).score : null;
    const sel = state.sel.kind === 'site' && state.sel.id === s.id;
    const icon = L.divIcon({ className: '', html: `<div class="site-pin${sel ? ' sel' : ''}" style="background:${scoreColor(sc)}">${sel ? sc ?? '' : ''}</div>`, iconSize: sel ? [26, 26] : [18, 18] });
    const m = L.marker([s.lat, s.lon], { icon, keyboard: true, title: s.name, riseOnHover: true, zIndexOffset: sel ? 1000 : Math.round(sc ?? 0) })
      .bindTooltip(`<b>${esc(s.name)}</b><br>${esc(s.region)}<br>${esc(t.name)} score: <b>${sc ?? '–'}</b>`, { direction: 'top', offset: [0, -8] })
      .on('click', () => onSelect({ kind: 'site', id: s.id }));
    m.addTo(siteLayer); markers.set(s.id, m);
  }
}

export function drawCandidates() {
  candLayer.clearLayers();
  for (const c of state.candidates) {
    L.circleMarker([c.lat, c.lon], { radius: 7, color: '#ff7a45', weight: 3, fillOpacity: 0.25 })
      .bindTooltip(`★ ${esc(c.name || 'Saved candidate')}<br>${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`)
      .on('click', ev => { L.DomEvent.stop(ev); onSelect({ kind: 'point', lat: c.lat, lon: c.lon }); })
      .addTo(candLayer);
  }
}

export function showPoint(lat, lon) {
  if (pointMarker) map.removeLayer(pointMarker);
  pointMarker = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#6ea8ff', fillOpacity: 0.9 }).addTo(map);
}
export function clearPoint() { if (pointMarker) { map.removeLayer(pointMarker); pointMarker = null; } }
export function flyTo(lat, lon, z) { map.flyTo([lat, lon], z ?? Math.max(map.getZoom(), 6), { duration: 0.8 }); }

// ---------- EONET events ----------
const EV_COLORS = { wildfires: '#f97316', volcanoes: '#ef4444', severeStorms: '#a78bfa', seaLakeIce: '#7dd3fc', dustHaze: '#d6b46b', floods: '#38bdf8', landslides: '#a16207', snow: '#e2e8f0', drought: '#facc15', earthquakes: '#f472b6', tempExtremes: '#fb7185' };
let eventsLoaded = false;
export async function loadEvents(force) {
  if (eventsLoaded && !force) return;
  try {
    const { data, t, cached } = await live('eonet', null, force ? 0 : 15 * 6e4);
    mark('NASA EONET', !cached);
    eventLayer.clearLayers();
    for (const e of data.events) {
      if (!e.g || e.g.type !== 'Point') continue;
      const [lon, lat] = e.g.c;
      L.circleMarker([lat, lon], { radius: 5, color: EV_COLORS[e.cat] || '#fbbf24', weight: 2, fillOpacity: 0.6 })
        .bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.catTitle)} · ${esc(new Date(e.g.date).toUTCString().slice(5, 16))}<br><a href="${esc(e.link)}" target="_blank" rel="noopener">Source</a>`)
        .addTo(eventLayer);
    }
    eventsLoaded = true;
    if (cached) toast(`Showing saved natural events from ${new Date(t).toLocaleString()}`);
  } catch { toast('Could not load NASA EONET events'); }
}
export const showEvents = () => { if (!map.hasLayer(eventLayer)) eventLayer.addTo(map); loadEvents(); };

// ---------- Discovery ----------
export const REGIONS = [
  { n: 'Sahara (Tibesti)', lat: 21, lon: 17 }, { n: 'Arabian Rub al Khali', lat: 20, lon: 50 }, { n: 'Tibetan Plateau', lat: 34, lon: 85 },
  { n: 'Gobi Desert', lat: 43, lon: 103 }, { n: 'Altiplano–Atacama', lat: -23, lon: -68 }, { n: 'Antarctic Dry Valleys', lat: -78, lon: 162 },
  { n: 'Canadian High Arctic', lat: 77, lon: -88 }, { n: 'Greenland coast', lat: 72, lon: -24 }, { n: 'Iceland highlands', lat: 65, lon: -18 },
  { n: 'Australian outback', lat: -25, lon: 132 }, { n: 'Namib–Kalahari', lat: -24, lon: 17 }, { n: 'Great Basin, USA', lat: 39, lon: -116 },
  { n: 'Iranian Lut Desert', lat: 31, lon: 59 }, { n: 'Taklamakan', lat: 39, lon: 83 }, { n: 'Afar Triangle', lat: 13, lon: 41 }, { n: 'Patagonia steppe', lat: -46, lon: -69 },
];

let scanCtl = null;
export async function runScan(lat, lon, ui) {
  if (scanCtl) scanCtl.abort();
  scanCtl = new AbortController();
  const t = target(), box = scanBox(lat, lon, 10);
  heatLayer.clearLayers();
  map.flyToBounds([[box.s, box.w], [box.n, box.e]], { duration: 0.8, padding: [10, 10] });
  const rect = L.rectangle([[box.s, box.w], [box.n, box.e]], { color: '#6ea8ff', weight: 1, dashArray: '4 4', fill: false }).addTo(heatLayer);
  ui.start(t, box);
  try {
    const res = await scan(t, box, { mission: state.mission, signal: scanCtl.signal, onProgress: ui.progress });
    mark('NASA POWER regional', true);
    if (res.jaxa) mark('JAXA Earth API', true);
    const r = L.canvas({ padding: 0.2 });
    for (const c of res.cells) {
      L.rectangle([[c.lat - 0.25, c.lon - 0.3125], [c.lat + 0.25, c.lon + 0.3125]], { renderer: r, stroke: false, fillColor: scoreColor(c.score), fillOpacity: 0.55, interactive: true })
        .bindTooltip(`Score ${c.score}<br>${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`)
        .on('click', ev => { L.DomEvent.stop(ev); onSelect({ kind: 'point', lat: c.lat, lon: c.lon }); })
        .addTo(heatLayer);
    }
    rect.bringToFront();
    res.candidates.forEach((c, i) => L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: `<div class="site-pin" style="background:#fff;border-color:#ff7a45;width:22px;height:22px">${i + 1}</div>`, iconSize: [22, 22] }) })
      .on('click', () => onSelect({ kind: 'point', lat: c.lat, lon: c.lon })).addTo(heatLayer));
    ui.done(res);
  } catch (e) {
    if (e.name !== 'AbortError') { mark('NASA POWER regional', false); ui.fail(e); }
  } finally { scanCtl = null; }
}
export function clearScan() { heatLayer.clearLayers(); }

export function missionOptions(sel) {
  return Object.entries(MISSIONS).map(([k, m]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
}
export function targetOptions(sel) {
  return ['moon', 'mars'].map(b => `<optgroup label="${b === 'moon' ? 'Moon' : 'Mars'}">${TARGETS.filter(t => t.body === b).map(t => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
}
export { fmt, set };
