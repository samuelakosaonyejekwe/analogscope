// Rankings, Twin view, Live feeds, Method, and the Discover panel.
import { state, set, target, site, siteProfile, snapshot, toast, fmt, ago, scoreColor, health, mark } from './state.js';
import { SITES } from './sites.js';
import { TARGETS, VARIABLES, GEOLOGY, MISSIONS, PLANET } from './targets.js';
import { evaluate } from './engine.js';
import { live, powerRecent, haversine, store } from './data.js';
import { esc, lineChart, safeUrl } from './charts.js';
import { marsClock, season, hhmm, expectedNow } from './mars.js';
import { gapsHtml } from './report.js';
import { REGIONS, runScan, clearScan, getMap, targetOptions, missionOptions } from './mapview.js';
import { NOVEL_KM } from './scan.js';

// Offline map pack size, measured by downloading every tile it contains
// (749 unique tiles, 11.6 MB in October 2026). Re-measure if the tile list changes.
const PACK_MB = 12;

// ---------------- Rankings ----------------
export function renderRank() {
  const t = target(), m = state.mission;
  document.getElementById('rankTarget').innerHTML = targetOptions(t.id);
  document.getElementById('rankMission').innerHTML = missionOptions(m);
  const rows = SITES.map(s => { const p = siteProfile(s.id); return { s, ev: p ? evaluate(t, p.ann, s.geo, m) : null, p }; })
    .sort((a, b) => (b.ev?.score ?? -1) - (a.ev?.score ?? -1));

  // matrix: sites x targets
  const mat = SITES.map(s => { const p = siteProfile(s.id); return { s, sc: TARGETS.map(x => p ? evaluate(x, p.ann, s.geo, m).score : null) }; })
    .sort((a, b) => Math.max(...b.sc.map(v => v ?? 0)) - Math.max(...a.sc.map(v => v ?? 0)));
  document.getElementById('matrix').innerHTML = `<h2 style="font-size:17px;margin:6px 0">Every site against every target</h2>
    <table class="matrix" aria-label="Score matrix"><thead><tr><th></th>${TARGETS.map(x => `<th class="rot" title="${esc(x.name)}"><span>${x.body === 'moon' ? '☾' : '♂'} ${esc(x.name)}</span></th>`).join('')}</tr></thead>
    <tbody>${mat.map(r => `<tr><td class="rowh">${esc(r.s.name)}</td>${r.sc.map((v, i) => `<td style="background:${scoreColor(v)}" data-s="${r.s.id}" data-t="${TARGETS[i].id}" title="${esc(r.s.name)} → ${esc(TARGETS[i].name)}: ${v ?? '–'}">${v ?? '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  document.getElementById('rankTable').innerHTML = `<h2 style="font-size:17px;margin:6px 0">Ranked for ${esc(t.name)} · ${esc(MISSIONS[m].label)}</h2>
  <table class="rank"><thead><tr><th>#</th><th>Site</th><th>Score</th><th class="hide-m">Environment</th><th class="hide-m">Geology</th><th class="hide-m">Used by</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr data-s="${r.s.id}" tabindex="0"><td class="num">${i + 1}</td><td class="site"><b>${esc(r.s.name)}</b><small>${esc(r.s.region)}</small></td>
    <td><span class="num" style="color:${scoreColor(r.ev?.score)}">${r.ev?.score ?? '–'}</span><div class="bar"><i style="width:${r.ev?.score ?? 0}%;background:${scoreColor(r.ev?.score)}"></i></div></td>
    <td class="hide-m num">${r.ev?.env.score == null ? '–' : Math.round(r.ev.env.score * 100)}</td><td class="hide-m num">${r.ev?.geo ? Math.round(r.ev.geo.score * 100) : '–'}</td>
    <td class="hide-m"><small class="muted">${esc(r.s.programs)}</small></td></tr>`).join('')}</tbody></table>`;

  // The router applies the selection and flies the map there.
  const go = (s, tid) => { location.hash = `#/map?s=${s}` + (tid ? `&t=${tid}` : ''); };
  document.querySelectorAll('#rankTable tr[data-s]').forEach(tr => { tr.onclick = () => go(tr.dataset.s); tr.onkeydown = e => e.key === 'Enter' && go(tr.dataset.s); });
  document.querySelectorAll('#matrix td[data-s]').forEach(td => td.onclick = () => go(td.dataset.s, td.dataset.t));
  document.getElementById('csvBtn').onclick = () => {
    const head = ['rank', 'site', 'region', 'lat', 'lon', ...TARGETS.map(x => x.id), 'programs'];
    const lines = [head.join(',')].concat(rows.map((r, i) => {
      const p = r.p;
      return [i + 1, r.s.name, r.s.region, r.s.lat, r.s.lon, ...TARGETS.map(x => p ? evaluate(x, p.ann, r.s.geo, m).score : ''), r.s.programs].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    }));
    const u = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: u, download: `analogscope-rankings-${t.id}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
}

// ---------------- Twin view ----------------
let twinE, twinP, twinPBody, twinMarkers = [], lastTwin = {}, twinS2, twinBM;
// Sentinel-2 cloudless has no usable imagery over Antarctica; NASA Blue Marble covers it.
export const S2_MIN_LAT = -60;
const S2_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
const BM_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const TREK = {
  moon: { url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg', attr: 'NASA LRO WAC mosaic · Moon Trek', max: 7 },
  mars: { url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg', attr: 'NASA Viking MDIM 2.1 · Mars Trek', max: 7 },
};

export function renderTwin(params) {
  const sid = params.get('s') || lastTwin.s || (state.sel.kind === 'site' ? state.sel.id : 'atacama');
  const tid = params.get('t') || lastTwin.t || state.target;
  const s = site(sid) || site('atacama'), t = target(tid) || target();
  lastTwin = { s: s.id, t: t.id };
  document.getElementById('twinSite').innerHTML = SITES.map(x => `<option value="${x.id}"${x.id === s.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  document.getElementById('twinTarget').innerHTML = targetOptions(t.id);
  document.getElementById('twinSite').onchange = e => location.hash = `#/twin?s=${e.target.value}&t=${t.id}`;
  document.getElementById('twinTarget').onchange = e => location.hash = `#/twin?s=${s.id}&t=${e.target.value}`;

  if (!twinE) {
    twinE = L.map('twinEarth', { attributionControl: true, zoomControl: true }).setView([s.lat, s.lon], 9);
    twinE.attributionControl.setPrefix(false);
    twinS2 = L.tileLayer(S2_URL, { maxNativeZoom: 15, maxZoom: 16, crossOrigin: true, attribution: 'Sentinel-2 cloudless by EOX (Copernicus Sentinel data 2021)' });
    twinBM = L.tileLayer(BM_URL, { maxNativeZoom: 8, maxZoom: 12, crossOrigin: true, attribution: 'NASA GIBS / Blue Marble' });
  }
  const polar = s.lat < S2_MIN_LAT;
  const [use, drop] = polar ? [twinBM, twinS2] : [twinS2, twinBM];
  if (twinE.hasLayer(drop)) twinE.removeLayer(drop);
  if (!twinE.hasLayer(use)) use.addTo(twinE);
  if (twinPBody !== t.body) {
    twinP?.remove();
    twinP = L.map('twinPlanet', { crs: L.CRS.EPSG4326, attributionControl: true, minZoom: 0, maxZoom: 8, worldCopyJump: false });
    twinP.attributionControl.setPrefix(false);
    L.tileLayer(TREK[t.body].url, { maxNativeZoom: TREK[t.body].max, maxZoom: 8, tileSize: 256, noWrap: true, crossOrigin: true, attribution: TREK[t.body].attr, bounds: [[-90, -180], [90, 180]] }).addTo(twinP);
    twinPBody = t.body;
  }
  twinMarkers.forEach(m => m.remove()); twinMarkers = [];
  twinE.setView([s.lat, s.lon], polar ? 8 : 10);
  const plat = Math.max(-85, Math.min(85, t.lat));
  twinP.setView([plat, t.lon], Math.abs(t.lat) > 80 ? 3 : 5);
  twinMarkers.push(L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#6ea8ff', fillOpacity: 0.8 }).addTo(twinE));
  twinMarkers.push(L.circleMarker([plat, t.lon], { radius: 8, color: '#fff', weight: 3, fillColor: t.body === 'mars' ? '#ff7a45' : '#b8c6ff', fillOpacity: 0.8 }).addTo(twinP));
  setTimeout(() => { twinE.invalidateSize(); twinP.invalidateSize(); }, 80);
  document.getElementById('capEarth').textContent = `Earth: ${s.name}, ${s.region} (${polar ? 'NASA Blue Marble; Sentinel-2 cloudless does not cover Antarctica' : 'ESA Sentinel-2 cloudless imagery'})`;
  document.getElementById('capPlanet').textContent = `${t.body === 'moon' ? 'Moon' : 'Mars'}: ${t.name}, ${t.lat.toFixed(2)}°, ${t.lon.toFixed(2)}° (NASA ${t.body === 'moon' ? 'LRO' : 'Viking'} mosaic${Math.abs(t.lat) > 85 ? `; this map ends at 85°, so the marker sits on its edge and polar terrain looks stretched` : ''})`;

  const p = siteProfile(s.id);
  const ev = p ? evaluate(t, p.ann, s.geo, state.mission) : null;
  document.getElementById('twinBody').innerHTML = `
  <div class="cols2">
    <div class="card"><h3>${esc(t.name)} <span class="tag">${t.body === 'moon' ? 'Moon' : 'Mars'}</span></h3><p style="margin:0 0 8px">${esc(t.blurb)}</p>
      <table class="cmp">${Object.entries(t.ref).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <p style="margin:8px 0 0">${t.geo.map(g => `<span class="tag ${s.geo.includes(g) ? 'hit' : ''}">${s.geo.includes(g) ? '✓ ' : ''}${esc(GEOLOGY[g])}</span>`).join('')}</p></div>
    <div class="card"><h3>${esc(s.name)} <span class="tag" style="color:${scoreColor(ev?.score)}">score ${ev?.score ?? '–'}</span></h3><p style="margin:0 0 8px">${esc(s.note)}</p>
      <table class="cmp"><tr><th>Factor</th><th>Earth value</th><th>Fit</th></tr>${ev ? ev.env.rows.map(r => `<tr><td>${esc(VARIABLES[r.v].label)}</td><td>${r.x == null ? '–' : fmt(r.x, VARIABLES[r.v].dp) + ' ' + VARIABLES[r.v].unit}</td><td style="color:${scoreColor(r.s == null ? null : r.s * 100)}">${r.s == null ? '–' : Math.round(r.s * 100) + '%'}</td></tr>`).join('') : ''}</table></div>
  </div>
  ${p && ev ? gapsHtml(t, p, ev) : ''}
  <div class="card" id="twinLive"><h3>Live: ${t.body === 'mars' ? 'Mars now vs. this site' : 'this site now'}</h3><div class="skeleton"></div></div>`;
  twinLive(s, t);
}

async function twinLive(s, t) {
  const box = document.getElementById('twinLive');
  const [earth, mars] = await Promise.allSettled([powerRecent(s.lat, s.lon, 20), t.body === 'mars' ? live('marsWeather', null, 3 * 3600e3) : Promise.resolve(null)]);
  if (!box.isConnected) return;
  const E = earth.status === 'fulfilled' ? earth.value : null;
  const n = E ? E.series.T2M.length - 1 : -1;
  const M = mars.status === 'fulfilled' && mars.value ? mars.value.data.soles?.find(x => x.min_temp !== '--') : null;
  if (E) mark('NASA POWER daily', true);
  if (M) mark('NASA Mars weather (REMS)', !mars.value.cached);
  const ed = E ? E.dates[n] : null;
  const ev = (k, f = 1) => (E && E.series[k]?.[n] != null ? E.series[k][n] * f : null);
  box.innerHTML = `<h3>Live: ${t.body === 'mars' ? 'Mars now vs. this site' : 'this site now'}</h3>
  <div class="cols2">
    <div><b>${esc(s.name)}</b> <span class="muted">· NASA POWER, ${ed ? `${ed.slice(0, 4)}-${ed.slice(4, 6)}-${ed.slice(6)}` : 'offline'}</span>
      <div class="kv" style="margin-top:6px"><div><small>Air min / max</small><b>${fmt(ev('T2M_MIN'), 0)} / ${fmt(ev('T2M_MAX'), 0)} °C</b></div>
      <div><small>Pressure</small><b>${fmt(ev('PS', 10), 0)} hPa</b></div>
      <div><small>Humidity</small><b>${fmt(ev('RH2M'), 0)} %</b></div>
      <div><small>UV index (24-h mean)</small><b>${fmt(ev('ALLSKY_SFC_UV_INDEX'), 1)}</b></div></div></div>
    ${t.body === 'mars' ? `<div><b>Gale Crater, Mars</b> <span class="muted">· Curiosity REMS, sol ${esc(M?.sol ?? '–')} (${esc(M?.terrestrial_date ?? 'unavailable')})</span>
      <div class="kv" style="margin-top:6px"><div><small>Air min / max</small><b>${M ? `${esc(M.min_temp)} / ${esc(M.max_temp)} °C` : '–'}</b></div>
      <div><small>Pressure</small><b>${M ? fmt(M.pressure / 100, 1) + ' hPa' : '–'}</b></div>
      <div><small>Ground min / max</small><b>${M && M.min_gts_temp !== '--' ? `${esc(M.min_gts_temp)} / ${esc(M.max_gts_temp)} °C` : '–'}</b></div>
      <div><small>UV level</small><b>${esc(M?.local_uv_irradiance_index ?? '–')}</b></div></div>
      ${(() => { const c = marsClock(), x = mars.status === 'fulfilled' && mars.value ? expectedNow(mars.value.data.clim, c.ls) : null; return x ? `<p style="margin:8px 0 0;font-size:13px">Now: Ls ${fmt(c.ls, 0)}°, ${esc(season(c.ls))}, ${hhmm(c.ltst(137.4))} local time at Gale. Typical at this season: <b>${fmt(x.min, 0)}° / ${fmt(x.max, 0)} °C</b>, ${fmt(x.p, 0)} Pa (REMS median).</p>` : ''; })()}
      ${M && ev('PS') != null && +M.pressure > 0 ? `<p style="margin:8px 0 0;font-size:13.5px">Surface pressure at Gale is about <b>${fmt(ev('PS', 1000) / M.pressure, 0)}×</b> lower than at ${esc(s.name)} today. No place on Earth gets close, which is why tests with very thin air have to be done in vacuum chambers.</p>` : ''}</div>`
    : `<div><b>${esc(t.name)}</b><p class="muted" style="margin:4px 0 0">There is no live weather station on the Moon. The reference values above come from LRO Diviner and Apollo measurements. Between lunar day and night the surface temperature changes by about ${PLANET.moon.surfaceSwingC} °C, compared with a daily air-temperature swing of ${ev('T2M_MAX') != null && ev('T2M_MIN') != null ? fmt(ev('T2M_MAX') - ev('T2M_MIN'), 0) : '–'} °C at this site today.</p></div>`}
  </div>`;
}

// ---------------- Live ----------------
/** force: refetch everything; soft: refetch without showing loading placeholders. */
export async function renderLive(force = false, soft = false) {
  const g = document.getElementById('liveGrid');
  if (!g.dataset.init || (force && !soft)) {
    g.dataset.init = 1;
    g.innerHTML = ['mars', 'sw', 'events', 'quakes', 'apod', 'status', 'offline'].map(id => `<div class="card" id="lc-${id}"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div>`).join('');
  }
  const age = force ? 0 : 10 * 6e4;
  const card = (id, html) => { const el = document.getElementById('lc-' + id); if (el) el.innerHTML = html; };
  const stamp = r => `<span class="tag ${r.cached ? 'stale' : 'live'}">${r.cached ? 'saved ' + ago(r.t) : 'live · ' + new Date(r.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

  live('marsWeather', null, force ? 0 : 3 * 3600e3).then(r => {
    mark('NASA Mars weather (REMS)', !r.cached);
    card('mars', marsCard(r, stamp(r)));
  }).catch(() => card('mars', marsCard(null, '')));

  Promise.allSettled([live('kp', null, age), live('xray', null, age)]).then(([kp, xr]) => {
    let html = '<h3>Space weather · NOAA SWPC</h3>';
    if (kp.status === 'fulfilled') {
      mark('NOAA SWPC', !kp.value.cached);
      const raw = kp.value.data;
      const rows = (Array.isArray(raw[0]) && raw[0][0] === 'time_tag' ? raw.slice(1) : raw).map(r => Array.isArray(r) ? [r[0], +r[1]] : [r.time_tag, +r.Kp]).filter(r => isFinite(r[1]));
      const last = rows[rows.length - 1] || [];
      const k = last[1];
      html = `<h3>Space weather · NOAA SWPC ${stamp(kp.value)}</h3><div class="big" style="color:${k >= 5 ? 'var(--bad)' : k >= 4 ? 'var(--warn)' : 'var(--ok)'}">Kp ${fmt(k, 1)}</div>
        <div class="muted">${k >= 5 ? 'Geomagnetic storm. Expect HF radio and GNSS problems for teams at polar analog sites (Devon Island, Svalbard, Antarctica).' : k >= 4 ? 'Active conditions. Polar field teams may see minor HF and GNSS degradation.' : 'Quiet. Normal radio and GNSS conditions for polar field teams.'}</div>
        ${lineChart(rows.slice(-56).map((r, i) => [i, r[1]]), { h: 60, bands: [{ v: 5, label: 'storm' }] })}<small class="muted">Planetary K-index, 3-hour values, last ${Math.round(Math.min(rows.length, 56) / 8)} days</small>`;
    }
    if (xr.status === 'fulfilled' && xr.value.data.length) {
      const f = xr.value.data[xr.value.data.length - 1].f;
      const cls = f >= 1e-4 ? 'X' : f >= 1e-5 ? 'M' : f >= 1e-6 ? 'C' : f >= 1e-7 ? 'B' : 'A';
      html += `<p style="margin:8px 0 2px">GOES X-ray flux: <b>${cls}${fmt(f / { X: 1e-4, M: 1e-5, C: 1e-6, B: 1e-7, A: 1e-8 }[cls], 1)}</b> class. Solar flares are the main radiation danger for crews on the Moon, which has no magnetic field or atmosphere to block them.</p>
        ${lineChart(xr.value.data.map((d, i) => [i, d.f]), { h: 60, log: true, bands: [{ v: 1e-5, label: 'M' }, { v: 1e-4, label: 'X' }] })}<small class="muted">GOES 0.1–0.8 nm X-ray flux, last 24 hours (log scale)</small>`;
    }
    card('sw', html);
  });

  live('eonet', null, age).then(r => {
    mark('NASA EONET', !r.cached);
    const ev = r.data.events, byCat = {};
    ev.forEach(e => byCat[e.catTitle] = (byCat[e.catTitle] || 0) + 1);
    const near = [];
    for (const e of ev) {
      if (!e.g || e.g.type !== 'Point') continue;
      let best = null, bd = 1e9;
      for (const s of SITES) { const d = haversine(s.lat, s.lon, e.g.c[1], e.g.c[0]); if (d < bd) { bd = d; best = s; } }
      if (bd < 600) near.push({ e, s: best, d: bd });
    }
    near.sort((a, b) => a.d - b.d);
    card('events', `<h3>Natural events · NASA EONET ${stamp(r)}</h3><div class="big">${ev.length}</div><div class="muted">open events in the last 60 days</div>
      <p>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="tag">${esc(k)} ${v}</span>`).join('')}</p>
      <b style="font-size:14px">Near analog sites (within 600 km)</b>${near.length ? `<ul class="list" style="margin-top:6px">${near.slice(0, 6).map(n => `<li><span class="dot"></span><span><b>${esc(n.e.title)}</b><br><span class="muted">${Math.round(n.d)} km from ${esc(n.s.name)}</span></span></li>`).join('')}</ul>` : '<p class="ok" style="margin:4px 0">No active events near analog sites.</p>'}
      <button class="btn" id="showEv" style="margin-top:8px">Show on map</button>`);
    document.getElementById('showEv').onclick = () => { location.hash = '#/map'; setTimeout(() => import('./mapview.js').then(m => m.showEvents()), 200); };
  }).catch(() => card('events', '<h3>Natural events</h3><p class="muted">Not available offline yet.</p>'));

  live('quakes', null, age).then(r => {
    mark('USGS earthquakes', !r.cached);
    // One entry per earthquake, attributed to its nearest analog site.
    const near = [];
    for (const q of r.data.features) {
      let best = null, bd = Infinity;
      for (const s of SITES) { const d = haversine(s.lat, s.lon, q.c[1], q.c[0]); if (d < bd) { bd = d; best = s; } }
      if (bd < 400) near.push({ q, s: best, d: bd });
    }
    near.sort((a, b) => b.q.mag - a.q.mag);
    card('quakes', `<h3>Earthquakes M4.5+ · USGS ${stamp(r)}</h3><div class="big">${r.data.features.length}</div><div class="muted">worldwide in the past 7 days</div>
      <b style="font-size:14px;display:block;margin-top:8px">Within 400 km of an analog site</b>${near.length ? `<ul class="list" style="margin-top:6px">${near.slice(0, 6).map(n => `<li><span class="dot"></span><span><b>M${fmt(n.q.mag, 1)}</b> ${esc(n.q.place)}<br><span class="muted">${Math.round(n.d)} km from ${esc(n.s.name)}</span></span></li>`).join('')}</ul>` : '<p class="ok" style="margin:4px 0">None this week.</p>'}`);
  }).catch(() => card('quakes', '<h3>Earthquakes</h3><p class="muted">Not available offline yet.</p>'));

  live('apod', state.apiKey || null, force ? 0 : 6 * 3600e3).then(r => {
    const a = r.data, iotd = a.source === 'iotd';
    mark(iotd ? 'NASA Image of the Day' : 'NASA APOD', !r.cached);
    const safe = safeUrl;
    card('apod', `<h3>${iotd ? 'NASA Image of the Day' : 'NASA Astronomy Picture of the Day'} ${stamp(r)}</h3><div class="apod">${safe(a.url) ? `<a href="${esc(safe(a.link) || safe(a.hdurl))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(safe(a.url))}" alt="${esc(a.title)}"></a>` : safe(a.link) ? `<a class="btn" href="${esc(safe(a.link))}" target="_blank" rel="noopener">Open today's ${a.media_type === 'video' ? 'video' : 'picture'}</a>` : ''}</div>
      <p style="margin:8px 0 0"><b>${esc(a.title)}</b> <span class="muted">· ${esc(a.date)}${a.copyright ? ' · © ' + esc(a.copyright.trim()) : ''}${a.media_type === 'video' ? ' · video' : ''}</span></p>
      ${iotd ? '<p class="muted" style="font-size:12px;margin:4px 0 0">The APOD service did not respond, so this is NASA’s Image of the Day instead. Adding your own free key from api.nasa.gov makes APOD more reliable:</p>' + keyForm() : ''}`);
  }).catch(() => card('apod', `<h3>NASA picture of the day</h3><p class="muted">Neither NASA picture service answered. The card will refresh automatically, or you can add your own free key from api.nasa.gov:</p>${keyForm()}`));

  setTimeout(() => statusCard(), 2500);
  offlineCard();
}

// Mars right now: computed clock + REMS seasonal normal + latest rover report.
function marsCard(r, stampHtml) {
  const c = marsClock(), sols = r ? r.data.soles.filter(x => x.min_temp !== '--').slice(0, 30) : [];
  const x = sols[0], exp = r ? expectedNow(r.data.clim, c.ls) : null;
  const ageDays = x ? Math.round((Date.now() - Date.parse(x.terrestrial_date)) / 864e5) : null;
  const gale = c.ltst(137.4), jez = c.ltst(77.58);
  const dayNight = h => (h >= 6 && h < 18 ? 'day' : 'night');
  return `<h3>Mars now · Gale Crater ${stampHtml}</h3>
    <div class="kv"><div><small>Season (Ls ${fmt(c.ls, 1)}°)</small><b style="font-size:13.5px">${esc(season(c.ls))}</b></div>
      <div><small>Local solar time</small><b>${hhmm(gale)}</b> <span class="muted">Gale · ${dayNight(gale)}</span><br><b>${hhmm(jez)}</b> <span class="muted">Jezero · ${dayNight(jez)}</span></div></div>
    ${exp ? `<p style="margin:10px 0 4px;font-size:13.5px"><b>Typical at this season:</b> about <b>${fmt(exp.min, 0)}° to ${fmt(exp.max, 0)} °C</b> air, ${fmt(exp.p, 0)} Pa${exp.gmin != null ? `, ground ${fmt(exp.gmin, 0)}° to ${fmt(exp.gmax, 0)} °C` : ''}.</p>
      <p class="muted" style="font-size:12px;margin:0">Median of ${exp.n} Curiosity sols at Ls ${Math.floor(c.ls / 10) * 10}–${Math.floor(c.ls / 10) * 10 + 10}° from earlier Mars years (${esc(r.data.clim.from?.slice(0, 4))}–${esc(r.data.clim.to?.slice(0, 4))}).</p>` : ''}
    ${x ? `<p style="margin:10px 0 2px;font-size:13.5px"><b>Latest rover report:</b> sol ${esc(x.sol)} (${esc(x.terrestrial_date)}): <b>${esc(x.min_temp)}° / ${esc(x.max_temp)} °C</b>, ${fmt(x.pressure, 0)} Pa, UV ${esc(x.local_uv_irradiance_index)}, ${esc(x.atmo_opacity)}.</p>
      ${ageDays > 10 ? `<p class="muted" style="font-size:12px;margin:0">NASA publishes REMS reports in batches, so the newest one is ${ageDays} days old. The season and solar times above are computed live.</p>` : ''}
      ${lineChart(sols.slice().reverse().map((q, i) => [i, +q.min_temp]), { h: 56 })}<small class="muted">Minimum air temperature, last ${sols.length} reported sols. Source: NASA JPL / CAB, Curiosity REMS. Clock: NASA GISS Mars24 algorithm.</small>`
    : '<p class="muted" style="margin:8px 0 0">Rover reports are not available offline yet. The season and solar times above are computed on your device.</p>'}`;
}

function keyForm() {
  return `<form id="keyForm" class="search" style="margin-top:6px"><input id="keyIn" type="password" placeholder="Your api.nasa.gov key (optional)" aria-label="NASA API key" value="${esc(state.apiKey)}"><button class="btn">Save</button></form><small class="muted">The key is stored only on this device and sent only to api.nasa.gov.</small>`;
}
document.addEventListener('submit', e => {
  if (e.target.id === 'keyForm') { e.preventDefault(); set({ apiKey: document.getElementById('keyIn').value.trim().slice(0, 64) }); toast('Key saved on this device'); renderLive(true); }
});

function statusCard() {
  const el = document.getElementById('lc-status'); if (!el) return;
  const names = ['NASA POWER', 'NASA POWER daily', 'NASA POWER regional', 'SRTM terrain', 'JAXA Earth API', 'NASA EONET', 'NASA Mars weather (REMS)', 'NASA APOD', 'NASA Image of the Day', 'NASA Image Library', 'NASA GIBS / ESA tiles', 'NOAA SWPC', 'USGS earthquakes'];
  el.innerHTML = `<h3>Data source status <span class="tag">this session</span></h3><table class="status-tbl">${names.map(n => {
    const h = health[n];
    return `<tr><td>${esc(n)}</td><td class="${h ? (h.ok ? 'ok' : 'warn') : 'muted'}">${h ? (h.ok ? '● live' : '● saved copy') : '○ not used yet'}</td><td class="muted">${h ? ago(h.t) : ''}</td></tr>`;
  }).join('')}</table><p class="muted" style="font-size:12px;margin:6px 0 0">Your browser fetches every source directly. Nothing goes through a server of ours, and nothing is tracked.</p>`;
}

async function offlineCard() {
  const el = document.getElementById('lc-offline'); if (!el) return;
  let est = '';
  try { const e = await navigator.storage?.estimate?.(); if (e) est = `${fmt(e.usage / 1048576, 1)} MB stored on this device`; } catch { /* unsupported */ }
  el.innerHTML = `<h3>Offline &amp; airplane mode</h3><p style="margin:0 0 8px">The app, all ${SITES.length} documented sites, their scores and your saved candidates already work offline. You can also save map tiles before travelling:</p>
    <button class="btn btn-primary" id="packBtn">Save offline map pack (about ${PACK_MB} MB)</button><div class="progress" hidden id="packProg"><i></i></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">${esc(est)}${snapshot.generated ? ` · built-in data snapshot from ${esc(new Date(snapshot.generated).toLocaleDateString())}` : ''}</p>`;
  document.getElementById('packBtn').onclick = savePack;
}

async function savePack() {
  const btn = document.getElementById('packBtn'), prog = document.getElementById('packProg');
  if (!navigator.onLine) { toast('Connect to the internet to download the offline pack.'); return; }
  btn.disabled = true; prog.hidden = false;
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const urls = [];
  const gibs = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/';
  for (let z = 0; z <= 4; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) urls.push(`${gibs}${z}/${y}/${x}.jpeg`);
  for (const s of SITES) {
    // Sentinel-2 imagery around each documented site: the tile and its 8 neighbours at the
    // zoom Twin view opens with (10), plus the parent tile at zoom 9.
    // Antarctic sites use Blue Marble at zoom 8 instead (see S2_MIN_LAT).
    const polar = s.lat < S2_MIN_LAT;
    for (const [z, k] of polar ? [[8, 1]] : [[9, 0], [10, 1]]) {
      const n = 2 ** z, x = Math.floor((s.lon + 180) / 360 * n), r = s.lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++)
        if (y + dy >= 0 && y + dy < n) urls.push((polar ? BM_URL : S2_URL).replace('{z}', z).replace('{y}', y + dy).replace('{x}', (x + dx + n) % n));
    }
  }
  for (const b of ['Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02', 'Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m'])
    for (let z = 0; z <= 2; z++) for (let x = 0; x < 2 ** (z + 1); x++) for (let y = 0; y < 2 ** z; y++) urls.push(`https://trek.nasa.gov/tiles/${b}/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`);
  // Nearby sites share tiles; request each tile once.
  urls.splice(0, urls.length, ...new Set(urls));
  // The service worker downloads the tiles into its pack cache and reports progress.
  const sw = (await navigator.serviceWorker?.ready)?.active;
  if (!sw) { btn.disabled = false; prog.hidden = true; toast('Offline storage is not available in this browser.'); return; }
  const res = await new Promise(resolve => {
    const ch = new MessageChannel();
    let last = { ok: 0, bytes: 0, done: 0, total: urls.length }, idle;
    // If the browser stops the worker mid-download, finish with what was saved;
    // pressing the button again resumes, since saved tiles are skipped.
    const watchdog = () => { clearTimeout(idle); idle = setTimeout(() => resolve({ ...last, stalled: true }), 60000); };
    ch.port1.onmessage = ({ data }) => {
      last = data; watchdog();
      prog.firstChild.style.width = `${Math.round(data.done / data.total * 100)}%`;
      if (data.finished) { clearTimeout(idle); resolve(data); }
    };
    watchdog();
    sw.postMessage({ type: 'pack', urls }, [ch.port2]);
  });
  // live feeds & site data for offline reading
  await Promise.allSettled(['eonet', 'kp', 'xray', 'quakes', 'marsWeather'].map(n => live(n)));
  await offlineCard();
  const b2 = document.getElementById('packBtn');
  if (b2) b2.textContent = res.stalled ? `Saved ${res.ok} of ${urls.length} tiles. Tap to continue` : `Saved ${res.ok} of ${urls.length} map tiles ✓ (${fmt(res.bytes / 1048576, 1)} MB downloaded)`;
  toast(res.stalled ? 'Download paused. Tap the button again to continue.' : 'Offline pack saved. You can now use maps in airplane mode.');
}

// ---------------- Discover panel ----------------
export function renderScanPanel(el) {
  const t = target();
  el.innerHTML = `<div class="card"><h3>Discover new analogs</h3>
    <p style="margin:0 0 8px;font-size:14px">Scores every NASA POWER grid cell (0.5° × 0.625°, about 55 km × up to 70 km) in a 10° × 10° area against <b>${esc(t.name)}</b>, using NASA climate and terrain data with JAXA/ESA vegetation, ground temperature, soil moisture and land cover. Cells more than ${NOVEL_KM} km from any documented site are labelled <span class="tag novel">NEW</span>: these are places that have not been studied as analogs yet.</p>
    ${(t.geoWeight ?? 0) >= 0.5 ? `<p style="font-size:13px;margin:0 0 8px">${esc(t.name)} depends on caves, so this scan also uses <b>cave evidence</b>: documented lava tubes and basaltic lava-flow volcanoes from the Smithsonian Global Volcanism Program. Cells with no evidence stay capped.</p>` : ''}
    <button class="btn btn-primary" id="scanHere">Scan the current map view</button>
    <button class="btn" id="scanClear">Clear</button>
    <div class="regions" aria-label="Suggested regions">${REGIONS.map((r, i) => `<button data-r="${i}">${esc(r.n)}</button>`).join('')}</div>
    <div class="progress" hidden id="scanProg"><i></i></div><div class="muted" id="scanMsg" style="font-size:12.5px"></div>
  </div><div id="scanRes"></div>${myCandidates()}`;
  const ui = {
    start: (tt, box) => { el.querySelector('#scanProg').hidden = false; el.querySelector('#scanProg i').style.width = '4%'; el.querySelector('#scanMsg').textContent = `Scanning ${box.s}°…${box.n}° lat, ${box.w}°…${box.e}° lon for ${tt.name}…`; el.querySelector('#scanRes').innerHTML = ''; },
    progress: (f, msg) => { el.querySelector('#scanProg i').style.width = `${Math.round(f * 100)}%`; el.querySelector('#scanMsg').textContent = `Loaded ${msg}…`; },
    done: res => {
      el.querySelector('#scanProg').hidden = true;
      el.querySelector('#scanMsg').textContent = `${res.cells.length} land cells scored${res.jaxa ? ' (JAXA/ESA layers included)' : ' (JAXA layers unavailable, so NASA data only)'}.`;
      el.querySelector('#scanRes').innerHTML = res.candidates.length ? `<div class="card"><h3>Top candidates</h3>${res.candidates.map((c, i) => `<button class="cand" data-lat="${c.lat}" data-lon="${c.lon}"><span class="sc" style="color:${scoreColor(c.score)}">${c.score}</span><span><b>#${i + 1} · ${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°</b> ${c.novel ? '<span class="tag novel">NEW</span>' : ''}${c.cave && c.cave !== 'none' ? ` <span class="tag hit">caves ${esc(c.cave)}</span>` : ''}<div class="meta">${c.novel ? `${fmt(c.nearestKm, 0)} km from the nearest documented site (${esc(c.nearest.name)})` : `Near ${esc(c.nearest.name)} (${fmt(c.nearestKm, 0)} km)`}</div></span></button>`).join('')}</div>` : '<div class="card empty">No land cells in this area.</div>';
      el.querySelectorAll('#scanRes .cand').forEach(b => b.onclick = () => set({ sel: { kind: 'point', lat: +b.dataset.lat, lon: +b.dataset.lon } }));
    },
    fail: e => { el.querySelector('#scanProg').hidden = true; el.querySelector('#scanMsg').textContent = `Scan stopped: ${e.message}.${navigator.onLine ? '' : ' Scanning needs an internet connection.'}`; },
  };
  el.querySelector('#scanHere').onclick = () => { const c = getMap().getCenter(); runScan(c.lat, ((c.lng + 540) % 360) - 180, ui); };
  el.querySelector('#scanClear').onclick = () => { clearScan(); el.querySelector('#scanRes').innerHTML = ''; el.querySelector('#scanMsg').textContent = ''; };
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const r = REGIONS[+b.dataset.r]; runScan(r.lat, r.lon, ui); });
  el.querySelectorAll('[data-cand]').forEach(b => b.onclick = () => { const c = state.candidates[+b.dataset.cand]; set({ sel: { kind: 'point', lat: c.lat, lon: c.lon } }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => set({ candidates: state.candidates.filter((_, i) => i !== +b.dataset.del) }));
}

function myCandidates() {
  if (!state.candidates.length) return `<div class="card"><h3>My candidates</h3><p class="muted" style="margin:0;font-size:13.5px">Tap any location, then choose “Save as candidate” to build your own list. It is stored on this device and works offline.</p></div>`;
  return `<div class="card"><h3>My candidates <span class="tag">${state.candidates.length}</span></h3>${state.candidates.map((c, i) => `<div style="display:flex;gap:6px;align-items:center"><button class="cand" data-cand="${i}" style="flex:1"><span>★</span><span><b>${esc(c.name)}</b><div class="meta">${c.lat.toFixed(3)}°, ${c.lon.toFixed(3)}°</div></span></button><button class="icon-btn" data-del="${i}" aria-label="Remove ${esc(c.name)}">✕</button></div>`).join('')}</div>`;
}

// ---------------- Method ----------------
export function renderMethod() {
  const el = document.getElementById('methodBody');
  if (el.dataset.init) return; el.dataset.init = 1;
  el.innerHTML = `<h1>How AnalogScope works</h1>
  <p class="lead">Planetary analog sites are places on Earth where crews and equipment can be tested before they fly. AnalogScope gives each place a 0–100 score for how well it represents eight Moon and Mars base or landing environments, shows the data behind the score, and searches large regions for analogs that have not been studied yet.</p>
  <h2>1. Targets</h2><p>${TARGETS.map(t => `<b>${esc(t.name)}</b> (${t.body === 'moon' ? 'Moon' : 'Mars'}): ${esc(t.short)}`).join(' · ')}.</p>
  <h2>2. Scoring</h2>
  <p>For each target, every measurable factor is given a <i>best</i> value (the most Moon- or Mars-like value found on Earth) and a <i>worst</i> value. The measured value is placed between the two and smoothed:</p>
  <div class="formula">fit = smoothstep( clamp( (x − worst) / (best − worst), 0, 1 ) )<br>EAI = Σ wᵢ·mᵢ·fitᵢ / Σ wᵢ·mᵢ   (m = mission-profile multiplier)<br>GCS = Σ weight of matching geology / Σ weight of target geology<br>AFS = (1 − g)·EAI + g·GCS   (g = 0.35, or 0.6 for cave targets)</div>
  <p><b>EAI</b> is the Environmental Analog Index, <b>GCS</b> the Geologic Context Score, and <b>AFS</b> the Analog Fidelity Score shown on the map. <b>Data coverage</b> is the share of factor weight that actually has data, so you can see how reliable a score is. Mission profiles (rover, ice and resources, astrobiology, habitat) change the weights because each kind of test needs different conditions.</p>
  <h2>3. Live and seasonal analysis</h2><p>Each site report also gives a <b>score from the last 30 days</b> of NASA POWER daily data, which shows whether conditions are currently more or less analog-like than usual. It also gives a <b>month-by-month score</b> to help choose when to run a field campaign. Hazards come from NASA EONET and USGS, and space-weather risk for polar field teams comes from NOAA SWPC.</p>
  <h2>4. Discovery</h2><p>A scan scores every 0.5° × 0.625° land cell in a 10° box. It uses NASA POWER regional climatology, JAXA rasters (MODIS NDVI, GCOM-C SGLI land surface temperature, GCOM-W AMSR2 soil moisture), ESA CCI / Copernicus C3S land cover, and SRTM-derived terrain. Ocean cells are left out. JAXA layers are monthly normals, so both points and scans use the mean of January, April, July and October to get annual values that match POWER's annual normals. High-scoring cells more than ${NOVEL_KM} km from every documented site are labelled as new candidates.</p>
  <h2>5. Data sources</h2>
  <table><tr><th>Source</th><th>Agency</th><th>Used for</th></tr>
  <tr><td><a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener">POWER</a> (MERRA-2, CERES, IMERG)</td><td>NASA</td><td>Temperature, temperature swing, precipitation, humidity, UV, solar energy, pressure, cloud cover, wind: long-term normals and daily values</td></tr>
  <tr><td><a href="https://data.earth.jaxa.jp/" target="_blank" rel="noopener">JAXA Earth API</a></td><td>JAXA (with NASA MODIS, ESA/C3S)</td><td>NDVI, day and night land surface temperature, soil moisture, land cover</td></tr>
  <tr><td><a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain tiles</a> (SRTM, ETOPO1)</td><td>NASA / NGA / NOAA</td><td>Elevation, local relief, slope</td></tr>
  <tr><td><a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">GIBS</a></td><td>NASA</td><td>Blue Marble, yesterday's VIIRS and MODIS imagery, land surface temperature, ASTER relief</td></tr>
  <tr><td><a href="https://s2maps.eu/" target="_blank" rel="noopener">Sentinel-2 cloudless</a></td><td>ESA Copernicus (EOX)</td><td>High-resolution Earth imagery</td></tr>
  <tr><td><a href="https://trek.nasa.gov/" target="_blank" rel="noopener">Moon Trek / Mars Trek</a></td><td>NASA</td><td>LRO WAC and Viking MDIM planetary mosaics</td></tr>
  <tr><td><a href="https://mars.nasa.gov/msl/weather/" target="_blank" rel="noopener">Curiosity REMS</a></td><td>NASA JPL / CAB (Spain)</td><td>Latest Mars weather at Gale Crater, and seasonal normals from the full archive</td></tr>
  <tr><td><a href="https://www.giss.nasa.gov/tools/mars24/" target="_blank" rel="noopener">Mars24 algorithm</a></td><td>NASA GISS</td><td>Current Mars season (Ls) and local solar time, computed on your device</td></tr>
  <tr><td><a href="https://volcano.si.edu/" target="_blank" rel="noopener">Volcanoes of the World</a></td><td>Smithsonian GVP</td><td>2,666 Holocene and Pleistocene volcanoes used as cave evidence (bundled for offline use)</td></tr>
  <tr><td><a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noopener">EONET</a></td><td>NASA</td><td>Live natural events near sites</td></tr>
  <tr><td><a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener">SWPC</a></td><td>NOAA</td><td>Kp index and GOES X-ray flux</td></tr>
  <tr><td><a href="https://earthquake.usgs.gov/" target="_blank" rel="noopener">Earthquake feed</a></td><td>USGS</td><td>Seismic hazards near sites</td></tr>
  <tr><td><a href="https://api.nasa.gov/" target="_blank" rel="noopener">APOD, Image of the Day, Image Library</a></td><td>NASA</td><td>Daily picture (with automatic fallback) and archive photos of sites</td></tr></table>
  <h2>6. Limitations and how the app handles them</h2>
  <p><b>No Earth site reaches vacuum, Mars pressure or low gravity.</b> Scores therefore measure how close Earth can get. Each site report includes a “What no Earth site can reproduce” card that shows how far the site is from the real value and which lab facility covers the rest, such as vacuum chambers, Mars-pressure wind tunnels, gravity offload systems or radiation beamlines.</p>
  <p><b>Satellites cannot see caves.</b> The cave targets use cave evidence instead: a list of documented lava tubes (full credit) and basaltic lava-flow volcanoes from the Smithsonian catalogue (half credit, labelled as inferred). Places with no evidence stay capped. You can also add geology you know from the field.</p>
  <p><b>Mars weather arrives in batches.</b> The Mars season and local times are computed live with NASA's Mars24 algorithm, and expected conditions come from the median of earlier Curiosity sols at the same season, so the card is current even when the newest rover report is weeks old.</p>
  <p><b>Grid data are coarse</b> (POWER cells are about 55 km across; scan terrain uses ≈1.2 km pixels, so slopes are smoother than in site reports), and geology tags summarise published studies. Terrain tiles use SRTM between 60°N and 56°S and coarser elevation models elsewhere, so polar relief is less detailed. Permits, access, safety and logistics are not modelled.</p>
  <h2>7. Privacy, security and offline use</h2><p>AnalogScope is a static, installable web app. There are no accounts, cookies, analytics or servers of ours: your browser requests data directly from each agency. A strict Content-Security-Policy limits the app to these sources. Settings and saved candidates stay on your device. A service worker stores the app, map tiles and the latest data so it keeps working in airplane mode, and it updates whenever you are back online.</p>
  <h2>8. Definitions</h2><table>${Object.entries(VARIABLES).map(([k, v]) => `<tr><td><b>${esc(v.label)}</b></td><td>${esc(v.unit)}</td><td>${esc(v.src)}</td></tr>`).join('')}</table>`;
}
