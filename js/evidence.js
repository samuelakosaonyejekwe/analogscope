// Cave evidence for the lava-tube targets, from two independent sources:
//  1. documented lava-tube caves (curated list), which confirm caves are present;
//  2. the Smithsonian GVP volcano catalogue: basaltic shields, fissure vents and
//     volcanic fields are where lava tubes form, so nearby ones make caves likely.

import { haversine } from './data.js';
import { LAVA_TUBES } from './lavatubes.js';

let vols = null;
export function loadVolcanoes() {
  return (vols ??= fetch('data/volcanoes.json').then(r => r.json()).then(j => j.v).catch(e => { vols = null; throw e; }));
}

/**
 * level: 'confirmed' (documented tube ≤ 30 km), 'likely' (Holocene basaltic effusive
 * volcano ≤ 40 km), 'possible' (other effusive volcano ≤ 30 km) or 'none'.
 * tags are the geology tags this evidence supports.
 */
export async function caveEvidence(lat, lon) {
  let list = [];
  try { list = await loadVolcanoes(); } catch { /* volcano data unavailable */ }
  return caveEvidenceSync(lat, lon, list);
}

export function caveEvidenceSync(lat, lon, list) {
  let tube = null, td = Infinity;
  for (const t of LAVA_TUBES) { const d = haversine(lat, lon, t.lat, t.lon); if (d < td) { td = d; tube = t; } }
  // Track the nearest volcano of each evidence class separately, so a closer but
  // weaker one (e.g. Pleistocene, rock type unknown) never masks stronger evidence.
  let near = null, nd = Infinity, eff = null, ed = Infinity, strong = null, sd = Infinity;
  for (const v of list) {
    if (Math.abs(v[0] - lat) > 2) continue;
    const d = haversine(lat, lon, v[0], v[1]);
    if (d < nd) { nd = d; near = v; }
    if (!v[4] || v[5] === 0) continue;                   // not a lava-flow volcano, or not basaltic
    if (d < ed) { ed = d; eff = v; }
    if (v[5] === 1 && v[6] === 'H' && d < sd) { sd = d; strong = v; }
  }
  const vol = v => v && { name: v[2], type: v[3], basaltic: v[5], epoch: v[6] === 'H' ? 'Holocene' : 'Pleistocene', lat: v[0], lon: v[1] };
  let level = 'none', tags = [];
  if (td <= 30) { level = 'confirmed'; tags = ['lavatube', 'basalt']; }
  else if (sd <= 40) { level = 'likely'; tags = ['lavaprone', 'basalt']; }
  else if (ed <= 30) { level = 'possible'; tags = ['lavaprone']; }
  const shown = level === 'likely' ? strong : eff, shownKm = level === 'likely' ? sd : ed;
  return {
    level, tags,
    tube: td <= 100 ? { ...tube, km: Math.round(td) } : null,
    effusive: shown && shownKm <= 100 ? { ...vol(shown), km: Math.round(shownKm) } : null,
    nearest: near && nd <= 150 ? { ...vol(near), km: Math.round(nd) } : null,
  };
}

export const LEVEL_TEXT = {
  confirmed: 'Documented lava-tube cave nearby',
  likely: 'Lava tubes likely: young basaltic lava-flow volcano nearby',
  possible: 'Lava tubes possible: lava-flow volcano nearby, rock type unrecorded',
  none: 'No cave evidence within 30–40 km',
};
