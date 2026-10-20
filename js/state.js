// Shared app state, persisted per device.
import { store, PROFILE_KEY } from './data.js';
import { TARGETS, MISSIONS } from './targets.js';
import { grade } from './engine.js';
import { SITES } from './sites.js';

// Saved state is validated field by field: anything stale, unknown or malformed
// falls back to a default instead of breaking the app.
const saved = store.get('state') || {};
const okNum = (v, lim) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= lim;
const validSel = s => (s?.kind === 'site' && SITES.some(x => x.id === s.id)) || (s?.kind === 'point' && okNum(s.lat, 90) && okNum(s.lon, 180));
const LAYER_IDS = ['bluemarble', 's2', 'viirs', 'modis', 'lst', 'relief'];
export const state = {
  target: TARGETS.some(t => t.id === saved.target) ? saved.target : 'mars-jezero',
  mission: MISSIONS[saved.mission] ? saved.mission : 'balanced',
  layer: LAYER_IDS.includes(saved.layer) ? saved.layer : 'bluemarble',
  sel: validSel(saved.sel) ? saved.sel : { kind: 'site', id: 'atacama' },
  candidates: Array.isArray(saved.candidates) ? saved.candidates.filter(c => okNum(c?.lat, 90) && okNum(c?.lon, 180)).map(c => ({ ...c, name: String(c.name || 'Candidate').slice(0, 80) })).slice(0, 200) : [],
  customGeo: saved.customGeo && typeof saved.customGeo === 'object' ? saved.customGeo : {},
  apiKey: typeof saved.apiKey === 'string' ? saved.apiKey.slice(0, 64) : '',
  seenIntro: !!saved.seenIntro,
};
const PERSIST = Object.keys(state);

const subs = new Set();
export const onChange = fn => subs.add(fn);
export function set(patch) {
  for (const k of PERSIST) if (k in patch) state[k] = patch[k];
  store.set('state', state);
  subs.forEach(fn => fn(patch));
}

export const target = id => TARGETS.find(t => t.id === (id || state.target));
export const site = id => SITES.find(s => s.id === id);

// Bundled snapshot of long-term normals for the documented sites (refreshed live when online).
export const snapshot = { sites: {}, generated: null };
export async function loadSnapshot() {
  try {
    const r = await fetch('data/snapshot.json');
    const j = await r.json();
    Object.assign(snapshot, j);
  } catch { /* first run offline without cache: live fetch will fill in */ }
}
export function siteProfile(id) {
  const s = site(id);
  const live = store.get(PROFILE_KEY(s.lat, s.lon));
  return live || snapshot.sites[id] || null;
}

let toastT;
export function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  // A modal dialog sits in the top layer; move the toast inside it so it stays visible.
  const dlg = document.getElementById('dlg');
  (dlg.open ? dlg : document.body).appendChild(el);
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}

export function dialog(title, html) {
  const d = document.getElementById('dlg');
  document.getElementById('dlgTitle').textContent = title;
  document.getElementById('dlgBody').innerHTML = html;
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}

export const fmt = (v, dp = 1) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
export const ago = t => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
/** Fill colour for a score (pins, bars, cells). */
export const scoreColor = s => grade(s).color;
/** Text colour for a score: a theme-aware CSS variable with readable contrast. */
export const scoreText = s => `var(--t-${grade(s).cls})`;

// Track which sources answered, for the status card.
export const health = {};
export function mark(src, ok) { health[src] = { ok, t: Date.now() }; }
