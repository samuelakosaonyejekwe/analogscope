// AnalogScope entry point: boot, routing and wiring between views.
import { state, set, onChange, site, loadSnapshot, toast, dialog } from './state.js';
import { TARGETS, MISSIONS } from './targets.js';
import { SITES } from './sites.js';
import { initMap, setBase, drawSites, drawCandidates, legend, showPoint, clearPoint, flyTo, invalidate, LAYERS, missionOptions, getMap } from './mapview.js';
import { renderReport } from './report.js';
import { renderRank, renderTwin, renderLive, renderMethod, renderScanPanel } from './pages.js';
import { initInstall } from './install.js';
import { initUpdates } from './updates.js';
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
  $('targetChips').innerHTML = TARGETS.map(t => `<button type="button" class="chip ${t.body}" role="radio" aria-checked="${t.id === state.target}" tabindex="${t.id === state.target ? 0 : -1}" data-t="${t.id}" title="${esc(t.blurb)}"><i></i>${esc(t.name)}</button>`).join('');
  $('targetChips').onclick = e => { const b = e.target.closest('[data-t]'); if (b) set({ target: b.dataset.t }); };
  // Radio-group keyboard pattern: arrow keys move the selection.
  $('targetChips').onkeydown = e => {
    const i = TARGETS.findIndex(t => t.id === state.target), d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = TARGETS[(i + d + TARGETS.length) % TARGETS.length];
    set({ target: next.id });
    document.querySelector(`#targetChips [data-t="${next.id}"]`)?.focus();
  };
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
    sheet(p.classList.contains('min') ? 'mid' : p.classList.contains('max') ? 'min' : 'max');
  };
  $('helpBtn').onclick = intro;
  // Skip link: move focus without touching the URL or history.
  $('skipLink').onclick = e => { e.preventDefault(); $('main').focus(); };
}

// Phone bottom sheet: 'min' | 'mid' | 'max'. The stage class keeps the location button above it.
function sheet(size) {
  const p = $('panel');
  p.classList.toggle('min', size === 'min');
  p.classList.toggle('max', size === 'max');
  p.parentElement.classList.toggle('pmin', size === 'min');
  p.parentElement.classList.toggle('pmax', size === 'max');
  $('sheetHandle').setAttribute('aria-expanded', String(size !== 'min'));
}

let ptab = 'site';
function panelTab(p) {
  ptab = p;
  document.querySelectorAll('.panel-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === p)));
  $('pSite').hidden = p !== 'site'; $('pScan').hidden = p !== 'scan';
  if ($('panel').classList.contains('min')) sheet('mid');
  renderPanel();
}
function renderPanel() {
  if (ptab === 'scan') renderScanPanel($('pScan'));
  else renderReport($('pSite'), state.sel);
}

function select(sel, fly) {
  set({ sel });
  // Selecting on the map must not add history entries; only switch pages when needed.
  if (view !== 'map') location.hash = '#/explore';
  if (fly) { const p = sel.kind === 'site' ? site(sel.id) : sel; flyTo(p.lat, p.lon, 7); }
}

onChange(patch => {
  if ('target' in patch) {
    document.querySelectorAll('#targetChips .chip').forEach(c => { const on = c.dataset.t === state.target; c.setAttribute('aria-checked', String(on)); c.tabIndex = on ? 0 : -1; });
    document.querySelector(`#targetChips [data-t="${state.target}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  if ('mission' in patch) $('missionSel').value = state.mission;
  if ('target' in patch || 'mission' in patch || 'customGeo' in patch) {
    drawSites(); legend();
    if (view === 'rank') renderRank();
    if (view === 'map') renderPanel();
  }
  if ('sel' in patch) {
    if (state.sel.kind === 'point') { showPoint(state.sel.lat, state.sel.lon); } else clearPoint();
    drawSites();
    if (view === 'map') { if (ptab !== 'site') panelTab('site'); else renderPanel(); }
    if (innerWidth <= 860 && $('panel').classList.contains('min')) sheet('mid');
  }
  if ('candidates' in patch) { drawCandidates(); if (ptab === 'scan') renderScanPanel($('pScan')); }
});

// ---------- router ----------
// The address bar stays clean: Explore is the bare app URL and the other pages
// are #/rankings, #/twin, #/live, #/method. Shared links (#/map?t=…&s=…) are
// still understood; they are applied and then tidied away.
export const PAGES = [
  { v: 'map', slug: '', label: 'Explore' },
  { v: 'rank', slug: 'rankings', label: 'Rankings' },
  { v: 'twin', slug: 'twin', label: 'Twin view' },
  { v: 'live', slug: 'live', label: 'Live' },
  { v: 'method', slug: 'method', label: 'Method' },
];
const ALIAS = { '': 'map', '/': 'map', '/map': 'map', '/explore': 'map', '/rank': 'rank', '/rankings': 'rank', '/twin': 'twin', '/live': 'live', '/method': 'method' };
const cleanUrl = v => location.pathname + location.search + (PAGES.find(p => p.v === v).slug ? '#/' + PAGES.find(p => p.v === v).slug : '');
const session = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
let top = +(session.get('as:top') || 0), idx = 0;

function route() {
  // In-page anchors such as the skip link (#main) are not routes.
  if (location.hash && !location.hash.startsWith('#/')) return;
  const [path, qs] = (location.hash || '').slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const v = ALIAS[path] || 'map';
  view = v;
  // History bookkeeping for the back / forward arrows.
  // A new history entry (link, tab or typed hash) has no index yet: it sits one past the current page.
  if (history.state?.i == null) { idx += 1; top = idx; }
  else idx = history.state.i;
  session.set('as:top', top);
  history.replaceState({ i: idx }, '', cleanUrl(v));
  navArrows();

  document.querySelectorAll('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  document.querySelectorAll('.tabs a').forEach(a => a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (v === 'map') {
    const t = params.get('t'); if (t && TARGETS.some(x => x.id === t) && t !== state.target) set({ target: t });
    const sid = params.get('s'), pt = params.get('p');
    if (sid && site(sid) && !(state.sel.kind === 'site' && state.sel.id === sid)) { set({ sel: { kind: 'site', id: sid } }); flyTo(site(sid).lat, site(sid).lon, 6); }
    else if (pt) { const [a, b] = pt.split(',').map(Number); if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (state.sel.lat !== a || state.sel.lon !== b)) { set({ sel: { kind: 'point', lat: a, lon: b } }); flyTo(a, b, 7); } }
    invalidate(); renderPanel();
  } else if (v === 'rank') renderRank();
  else if (v === 'twin') renderTwin(params);
  else if (v === 'live') renderLive();
  else if (v === 'method') renderMethod();
  pager(v);
  document.title = `AnalogScope – ${PAGES.find(p => p.v === v).label}`;
  if (v !== 'map') document.querySelector(`#v-${v}`)?.scrollTo?.({ top: 0 });
}
addEventListener('hashchange', route);
addEventListener('popstate', () => { if (history.state?.i != null) { idx = history.state.i; navArrows(); } });

function navArrows() {
  $('navBack').disabled = idx <= 0;
  $('navFwd').disabled = idx >= top;
}

// Previous / next page cards at the foot of every page.
function pager(v) {
  const i = PAGES.findIndex(p => p.v === v), prev = PAGES[i - 1], next = PAGES[i + 1];
  const html = `<nav class="pager" aria-label="Page navigation">
    ${prev ? `<a class="pg prev" href="#/${prev.slug || 'explore'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span><small>Previous</small>${esc(prev.label)}</span></a>` : '<span></span>'}
    ${next ? `<a class="pg next" href="#/${next.slug}"><span><small>Next</small>${esc(next.label)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a>` : '<span></span>'}
  </nav>`;
  document.querySelectorAll('.pager-slot').forEach(el => { el.innerHTML = el.closest('.view').id === 'v-' + v ? html : ''; });
}

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

// ---------- boot ----------
(async function boot() {
  net();
  buildControls();
  initInstall();
  await loadSnapshot();
  initMap($('map'), sel => select(sel, false));
  if (history.state?.i == null) { history.replaceState({ i: 0 }, '', location.href); top = 0; }
  else idx = history.state.i;
  $('navBack').onclick = () => history.back();
  $('navFwd').onclick = () => history.forward();
  addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || !e.altKey) return;
    // Alt + ←/→ already works in browsers; Alt + ↑/↓ steps through the pages in order.
    const i = PAGES.findIndex(p => p.v === view);
    if (e.key === 'ArrowDown' && PAGES[i + 1]) location.hash = '#/' + PAGES[i + 1].slug;
    if (e.key === 'ArrowUp' && PAGES[i - 1]) location.hash = '#/' + (PAGES[i - 1].slug || 'explore');
  });
  route();
  const s = state.sel.kind === 'site' ? site(state.sel.id) : state.sel;
  if (s && view === 'map') getMap().setView([s.lat, s.lon], 4);
  if (state.sel.kind === 'point') showPoint(state.sel.lat, state.sel.lon);
  if (!state.seenIntro) setTimeout(intro, 600);
  initUpdates();
  // Keep live feeds warm while the app is open.
  setInterval(() => { if (navigator.onLine && view === 'live' && !document.hidden) renderLive(true, true); }, 15 * 6e4);
})();
