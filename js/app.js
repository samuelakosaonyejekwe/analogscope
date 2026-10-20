// AnalogScope entry point: boot, routing and wiring between views.
import { state, set, onChange, site, loadSnapshot, toast, dialog } from './state.js';
import { TARGETS, MISSIONS } from './targets.js';
import { SITES } from './sites.js';
import { initMap, setBase, drawSites, drawCandidates, legend, showPoint, clearPoint, flyTo, invalidate, LAYERS, missionOptions, getMap } from './mapview.js';
import { renderReport } from './report.js';
import { renderRank, renderTwin, renderLive, renderMethod, renderScanPanel } from './pages.js';
import { initInstall } from './install.js';
import { esc } from './charts.js';

const $ = id => document.getElementById(id);
let view = null;

// ---------- theme ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('as:theme')); } catch { /* storage blocked */ }
$('themeBtn').onclick = () => {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('as:theme', next); } catch { /* ignore */ }
};

// ---------- network pill ----------
function net() {
  const p = $('netPill');
  if (navigator.onLine) { p.textContent = '● Live data'; p.className = 'pill on'; p.title = 'Online: data is fetched live from NASA, JAXA, ESA and NOAA'; }
  else { p.textContent = '● Offline'; p.className = 'pill off'; p.title = 'Offline: showing saved data'; }
}
addEventListener('online', () => { net(); toast('Back online. Refreshing live data.'); if (view === 'live') renderLive(true); else if (view === 'map') renderPanel(); });
addEventListener('offline', () => { net(); toast('You are offline. Showing saved data.'); });

// ---------- controls ----------
function buildControls() {
  $('targetChips').innerHTML = TARGETS.map(t => `<button type="button" class="chip ${t.body}" role="radio" aria-checked="${t.id === state.target}" data-t="${t.id}" title="${esc(t.blurb)}"><i></i>${esc(t.name)}</button>`).join('');
  $('targetChips').onclick = e => { const b = e.target.closest('[data-t]'); if (b) set({ target: b.dataset.t }); };
  $('missionSel').innerHTML = missionOptions(state.mission);
  $('missionSel').onchange = e => { set({ mission: e.target.value }); toast(MISSIONS[e.target.value].note, 4500); };
  $('layerSel').innerHTML = Object.entries(LAYERS).map(([k, l]) => `<option value="${k}"${k === state.layer ? ' selected' : ''}>${esc(l.label)}</option>`).join('');
  $('layerSel').onchange = e => { set({ layer: e.target.value }); setBase(e.target.value); };
  $('siteList').innerHTML = SITES.map(s => `<option value="${esc(s.name)}">${esc(s.region)}</option>`).join('');
  $('searchForm').onsubmit = e => {
    e.preventDefault();
    const q = $('searchIn').value.trim();
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = +m[1], lon = +m[2];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return toast('Coordinates out of range');
      return select({ kind: 'point', lat, lon }, true);
    }
    const s = SITES.find(x => x.name.toLowerCase() === q.toLowerCase()) || SITES.find(x => (x.name + ' ' + x.region).toLowerCase().includes(q.toLowerCase()));
    if (s) select({ kind: 'site', id: s.id }, true); else toast('No matching site. Try “Atacama” or “-24.5, -69.2”.');
  };
  $('searchIn').addEventListener('change', () => { if (SITES.some(x => x.name === $('searchIn').value)) $('searchForm').requestSubmit(); });
  $('rankTarget').onchange = e => set({ target: e.target.value });
  $('rankMission').onchange = e => set({ mission: e.target.value });
  $('refreshBtn').onclick = () => renderLive(true);
  $('locBtn').onclick = () => {
    if (!navigator.geolocation) return toast('Location is not available on this device');
    navigator.geolocation.getCurrentPosition(p => select({ kind: 'point', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }, true),
      () => toast('Location permission denied'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 6e5 });
  };
  // panel tabs
  document.querySelectorAll('.panel-tabs button').forEach(b => b.onclick = () => panelTab(b.dataset.p));
  // bottom sheet on phones: tap handle to cycle size
  $('sheetHandle').onclick = () => {
    const p = $('panel');
    if (p.classList.contains('min')) p.classList.remove('min');
    else if (p.classList.contains('max')) { p.classList.remove('max'); p.classList.add('min'); }
    else p.classList.add('max');
    $('panel').parentElement.classList.toggle('pmin', p.classList.contains('min'));
  };
  $('helpBtn').onclick = intro;
}

let ptab = 'site';
function panelTab(p) {
  ptab = p;
  document.querySelectorAll('.panel-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === p)));
  $('pSite').hidden = p !== 'site'; $('pScan').hidden = p !== 'scan';
  $('panel').classList.remove('min');
  renderPanel();
}
function renderPanel() {
  if (ptab === 'scan') renderScanPanel($('pScan'));
  else renderReport($('pSite'), state.sel);
}

function select(sel, fly) {
  set({ sel });
  if (location.hash.split('?')[0] !== '#/map') location.hash = '#/map';
  if (fly) { const p = sel.kind === 'site' ? site(sel.id) : sel; flyTo(p.lat, p.lon, 7); }
}

onChange(patch => {
  if ('target' in patch) {
    document.querySelectorAll('#targetChips .chip').forEach(c => c.setAttribute('aria-checked', String(c.dataset.t === state.target)));
    document.querySelector(`#targetChips [data-t="${state.target}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  if ('mission' in patch) $('missionSel').value = state.mission;
  if ('target' in patch || 'mission' in patch || 'customGeo' in patch) {
    drawSites(); legend();
    if (view === 'rank') renderRank();
    if (view === 'map') renderPanel();
  }
  if ('sel' in patch) {
    if (patch._panel) { delete state._panel; ptab = 'site'; panelTab('site'); }
    if (state.sel.kind === 'point') { showPoint(state.sel.lat, state.sel.lon); } else clearPoint();
    drawSites();
    if (view === 'map') { if (ptab !== 'site') panelTab('site'); else renderPanel(); }
    if (innerWidth <= 860) $('panel').classList.remove('min');
    syncHash();
  }
  if ('candidates' in patch) { drawCandidates(); if (ptab === 'scan') renderScanPanel($('pScan')); }
});

function syncHash() {
  if (view !== 'map') return;
  const s = state.sel;
  const h = `#/map?t=${state.target}&` + (s.kind === 'site' ? `s=${s.id}` : `p=${s.lat},${s.lon}`);
  if (location.hash !== h) history.replaceState(null, '', h);
}

// ---------- router ----------
function route() {
  const [path, qs] = (location.hash || '#/map').slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const v = ({ '/map': 'map', '/rank': 'rank', '/twin': 'twin', '/live': 'live', '/method': 'method' })[path] || 'map';
  view = v;
  document.querySelectorAll('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  document.querySelectorAll('.tabs a').forEach(a => a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (v === 'map') {
    const t = params.get('t'); if (t && TARGETS.some(x => x.id === t) && t !== state.target) set({ target: t });
    const sid = params.get('s'), pt = params.get('p');
    if (sid && site(sid) && !(state.sel.kind === 'site' && state.sel.id === sid)) { set({ sel: { kind: 'site', id: sid } }); flyTo(site(sid).lat, site(sid).lon, 6); }
    else if (pt) { const [a, b] = pt.split(',').map(Number); if (isFinite(a) && isFinite(b) && (state.sel.lat !== a || state.sel.lon !== b)) { set({ sel: { kind: 'point', lat: a, lon: b } }); flyTo(a, b, 7); } }
    invalidate(); renderPanel();
  } else if (v === 'rank') renderRank();
  else if (v === 'twin') renderTwin(params);
  else if (v === 'live') renderLive();
  else if (v === 'method') renderMethod();
  document.title = `AnalogScope – ${({ map: 'Explore', rank: 'Rankings', twin: 'Twin view', live: 'Live feeds', method: 'Method' })[v]}`;
}
addEventListener('hashchange', route);

function intro() {
  dialog('Welcome to AnalogScope', `<p>Find places on Earth that can stand in for future <b>Moon</b> and <b>Mars</b> base sites, using live open data from NASA, JAXA, ESA and NOAA.</p>
  <ol class="steps">
    <li><b>Choose a target</b> along the top: the Artemis south-pole base region, the Jezero delta, Martian caves and others.</li>
    <li><b>Tap a coloured site</b> or <b>anywhere on the map</b>. You get a 0–100 score with the data behind it, the best months for fieldwork, live conditions and nearby hazards.</li>
    <li>Use <b>Discover</b> in the side panel to scan any region and find new analogs that have not been studied yet.</li>
    <li>Use <b>Rankings</b>, <b>Twin view</b> (Earth next to Moon or Mars) and <b>Live</b> (Mars weather, space weather, natural events).</li>
    <li>Use <b>Install app</b> to add it to your phone or computer. It also works offline and in airplane mode.</li>
  </ol>`);
  set({ seenIntro: true });
}

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready and will load next time you open the app.', 5000);
      });
    });
    // Periodic background refresh of live feeds where supported (installed Chromium apps).
    if ('periodicSync' in reg) navigator.permissions?.query({ name: 'periodic-background-sync' }).then(s => { if (s.state === 'granted') reg.periodicSync.register('refresh-live', { minInterval: 6 * 3600e3 }).catch(() => {}); }).catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  }).catch(() => {});
}

// ---------- boot ----------
(async function boot() {
  net();
  buildControls();
  initInstall();
  await loadSnapshot();
  initMap($('map'), sel => select(sel, false));
  if (!location.hash) history.replaceState(null, '', `#/map?t=${state.target}&` + (state.sel.kind === 'site' ? `s=${state.sel.id}` : `p=${state.sel.lat},${state.sel.lon}`));
  route();
  const s = state.sel.kind === 'site' ? site(state.sel.id) : state.sel;
  if (s && view === 'map') getMap().setView([s.lat, s.lon], 4);
  if (state.sel.kind === 'point') showPoint(state.sel.lat, state.sel.lon);
  if (!state.seenIntro) setTimeout(intro, 600);
  registerSW();
  // Keep live feeds warm while the app is open.
  setInterval(() => { if (navigator.onLine && view === 'live') renderLive(true); }, 15 * 6e4);
})();
