// Cave evidence for the lava-tube targets, from two independent sources:
//  1. documented lava-tube caves (data/lavatubes.json: exact coordinates from Wikidata,
//     built by tools/build_lavatubes.py), which confirm caves are present;
//  2. the Smithsonian GVP volcano catalogue: basaltic shields, fissure vents and
//     volcanic fields are where lava tubes form, so nearby ones make caves likely.

import { haversine } from './data.js';

let vols = null, tubes = null;
export function loadVolcanoes() {
  return (vols ??= fetch('data/volcanoes.json').then(r => r.json()).then(j => j.v).catch(e => { vols = null; throw e; }));
}
/** Documented lava tubes as [lat, lon, name, wikidataId]. */
export function loadTubes() {
  return (tubes ??= fetch('data/lavatubes.json').then(r => r.json()).then(j => j.v).catch(e => { tubes = null; throw e; }));
}
/** Radius within which a documented lava tube confirms caves at a location. Lava-tube
 *  systems run for kilometres to tens of kilometres (Kazumura Cave is 65 km long). */
export const TUBE_KM = 30;

/**
 * level: 'confirmed' (documented tube ≤ 30 km), 'likely' (Holocene basaltic effusive
 * volcano ≤ 40 km), 'possible' (other effusive volcano ≤ 30 km) or 'none'.
 * tags are the geology tags this evidence supports.
 */
export async function caveEvidence(lat, lon) {
  const [list, tl] = await Promise.all([loadVolcanoes().catch(() => []), loadTubes().catch(() => [])]);
  return caveEvidenceSync(lat, lon, list, tl);
}

export function caveEvidenceSync(lat, lon, list, tubeList = []) {
  let tube = null, td = Infinity;
  for (const t of tubeList) { const d = haversine(lat, lon, t[0], t[1]); if (d < td) { td = d; tube = t; } }
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
  if (td <= TUBE_KM) { level = 'confirmed'; tags = ['lavatube', 'basalt']; }
  else if (sd <= 40) { level = 'likely'; tags = ['lavaprone', 'basalt']; }
  else if (ed <= 30) { level = 'possible'; tags = ['lavaprone']; }
  const shown = level === 'likely' ? strong : eff, shownKm = level === 'likely' ? sd : ed;
  return {
    level, tags,
    tube: td <= 100 ? { name: tube[2], ref: tube[3], lat: tube[0], lon: tube[1], km: Math.round(td) } : null,
    effusive: shown && shownKm <= 100 ? { ...vol(shown), km: Math.round(shownKm) } : null,
    nearest: near && nd <= 150 ? { ...vol(near), km: Math.round(nd) } : null,
  };
}

export const LEVEL_TEXT = {
  confirmed: 'Documented lava-tube cave nearby',
  likely: 'Lava tubes likely: young basaltic lava-flow volcano nearby',
  possible: 'Lava tubes possible: lava-flow volcano nearby, rock type unrecorded',
  none: `No cave evidence within ${TUBE_KM}–40 km`,
};
