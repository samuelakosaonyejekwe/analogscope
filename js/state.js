// Shared app state, persisted per device.
import { store } from './data.js';
import { TARGETS } from './targets.js';
import { SITES } from './sites.js';

const saved = store.get('state') || {};
export const state = {
  target: TARGETS.some(t => t.id === saved.target) ? saved.target : 'mars-jezero',
  mission: saved.mission || 'balanced',
  layer: saved.layer || 'bluemarble',
  sel: saved.sel || { kind: 'site', id: 'atacama' },
  candidates: Array.isArray(saved.candidates) ? saved.candidates.slice(0, 200) : [],
  customGeo: saved.customGeo || {},
  apiKey: saved.apiKey || '',
  seenIntro: !!saved.seenIntro,
};

const subs = new Set();
export const onChange = fn => subs.add(fn);
export function set(patch) {
  Object.assign(state, patch);
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
  const live = store.get(`p:${s.lat.toFixed(2)},${s.lon.toFixed(2)}`);
  return live || snapshot.sites[id] || null;
}

let toastT;
export function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
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
export const scoreColor = s => s == null ? '#64748b' : s >= 80 ? '#34d399' : s >= 65 ? '#7dd3fc' : s >= 50 ? '#fbbf24' : s >= 35 ? '#fb923c' : '#f87171';

// Track which sources answered, for the status card.
export const health = {};
export function mark(src, ok) { health[src] = { ok, t: Date.now() }; }
