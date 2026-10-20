// Discovery scan: scores every NASA POWER grid cell (0.5° lat × 0.625° lon, about
// 55 km × up to 70 km) inside a box of up to 10° × 10° against a target, using only
// measured data, to surface candidate analogs that are not yet documented.

import { powerRegional, jaxaRegion, terrainAt, haversine } from './data.js';
import { environmental, evaluate } from './engine.js';
import { loadVolcanoes, loadTubes, caveEvidenceSync } from './evidence.js';
import { SITES } from './sites.js';

/** A candidate this far from every documented site is labelled as new. */
export const NOVEL_KM = 150;

const POWER_SRC = { T2M: 'T2M', T2M_RANGE: 'T2M_RANGE', PRECIP: 'PRECTOTCORR', RH2M: 'RH2M', UV: 'ALLSKY_SFC_UV_INDEX', SOLAR: 'ALLSKY_SFC_SW_DWN', PS: 'PS', CLOUD: 'CLOUD_AMT', WIND: 'WS2M' };
const abortIf = signal => { if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); };

export function scanBox(lat, lon, size = 10) {
  const h = size / 2;
  const s = Math.max(-89.5, Math.round((lat - h) * 2) / 2), n = Math.min(89.5, s + size);
  const w = Math.max(-180, Math.round((lon - h) * 2) / 2), e = Math.min(180, w + size);
  return { s, n: Math.max(n, s + 2), w, e: Math.max(e, w + 2) };
}

async function pool(tasks, n) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

export async function scan(target, box, { mission = 'balanced', onProgress = () => {}, signal } = {}) {
  const needed = target.criteria.map(c => c.v);
  const powerVars = needed.filter(v => POWER_SRC[v]);
  let done = 0; const total = powerVars.length + 2;
  const tick = msg => onProgress(++done / total, msg);

  // 1. NASA POWER grids
  const grids = await pool(powerVars.map(v => async () => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const g = await powerRegional(POWER_SRC[v], box, signal);
    tick(`NASA POWER: ${v}`);
    return [v, g];
  }), 3);
  const cells = new Map();
  for (const [v, g] of grids) for (const p of g) {
    const k = p.lat.toFixed(3) + ',' + p.lon.toFixed(3);
    const c = cells.get(k) || { lat: p.lat, lon: p.lon, vals: { ABSLAT: Math.abs(p.lat) } };
    c.vals[v] = v === 'PRECIP' && p.ann != null ? p.ann * 365 : p.ann;
    cells.set(k, c);
  }
  const list = [...cells.values()];

  // 2. JAXA / ESA rasters (four-season annual means), sampled at twice the POWER grid resolution
  abortIf(signal);
  const W = Math.round((box.e - box.w) / 0.25), H = Math.round((box.n - box.s) / 0.25);
  const jx = await jaxaRegion(box, W, H).catch(() => null);
  const pick = (arr, lat, lon) => {
    if (!arr) return null;
    const i = Math.min(W - 1, Math.max(0, Math.floor((lon - box.w) / (box.e - box.w) * W)));
    const j = Math.min(H - 1, Math.max(0, Math.floor((box.n - lat) / (box.n - box.s) * H)));
    const v = arr[j * W + i];
    return v == null || !isFinite(v) ? null : v;
  };
  for (const c of list) {
    for (const k of ['NDVI', 'SOILM', 'LST_NIGHT', 'LST_SWING', 'BARREN']) c.vals[k] = pick(jx?.[k], c.lat, c.lon);
    c.lc = pick(jx?.LC, c.lat, c.lon);
  }
  tick('JAXA & ESA satellite layers');

  // 3. Terrain, always fetched because it also masks out ocean cells. Zoom 7
  // (≈1.2 km pixels) with a 3-pixel window gives about the same ≈3–4 km relief
  // window as the site report; slopes are smoother than at full resolution.
  abortIf(signal);
  await pool(list.map(c => async () => {
    abortIf(signal);
    try { Object.assign(c.vals, await terrainAt(c.lat, c.lon, 7, 1)); } catch { /* terrain optional */ }
  }), 8);
  tick('SRTM terrain');
  abortIf(signal);

  // 4. Score land cells. Cave targets also use cave evidence (volcanoes and documented tubes).
  const caveTarget = (target.geoWeight ?? 0) >= 0.5;
  const [vols, tubes] = caveTarget ? await Promise.all([loadVolcanoes().catch(() => []), loadTubes().catch(() => [])]) : [null, null];
  const scored = [];
  for (const c of list) {
    // Land cover decides when it is known (so below-sea-level land such as Death Valley
    // or the Dead Sea is kept); otherwise treat low cells with no land signal as water.
    const water = c.lc != null ? c.lc === 210 : c.vals.NDVI == null && (c.vals.ELEV ?? 0) <= 0;
    if (water) continue;
    const e = environmental(target, c.vals, mission);
    if (e.score == null) continue;
    let score = Math.round(e.score * 100), cave = null;
    if (caveTarget) { cave = caveEvidenceSync(c.lat, c.lon, vols, tubes); score = evaluate(target, c.vals, [], mission, cave.tags).score; }
    scored.push({ ...c, score, coverage: e.coverage, cave: cave?.level });
  }

  // 5. Candidate peaks at least ~1° apart
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const picks = [];
  for (const c of sorted) {
    if (picks.length >= 8) break;
    if (picks.some(p => Math.abs(p.lat - c.lat) < 1 && Math.abs(p.lon - c.lon) < 1.2)) continue;
    let near = null, dist = Infinity;
    for (const s of SITES) { const d = haversine(c.lat, c.lon, s.lat, s.lon); if (d < dist) { dist = d; near = s; } }
    picks.push({ ...c, nearest: near, nearestKm: Math.round(dist), novel: dist > NOVEL_KM });
  }
  return { box, cells: scored, candidates: picks, jaxa: !!jx };
}
