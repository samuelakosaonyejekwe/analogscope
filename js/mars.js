// Mars time and seasonal weather.
// Clock: NASA GISS Mars24 algorithm (Allison & McEwen 2000), computed in the browser,
// so it is always current. Seasonal weather: medians of Curiosity REMS reports
// from previous Mars years at the same solar longitude (Ls).

const rad = Math.PI / 180;
const mod = (a, n) => ((a % n) + n) % n;

export function marsClock(date = new Date()) {
  const jdUT = date.getTime() / 864e5 + 2440587.5;
  const jdTT = jdUT + 69.184 / 86400;              // TT − UTC (37 leap seconds + 32.184 s)
  const dt = jdTT - 2451545.0;
  const M = mod(19.3871 + 0.52402073 * dt, 360);
  const aFMS = mod(270.3871 + 0.524038496 * dt, 360);
  const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018];
  const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
  const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
  let pbs = 0;
  for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos((0.985626 * dt / tau[i] + phi[i]) * rad);
  const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(M * rad) + 0.623 * Math.sin(2 * M * rad) + 0.050 * Math.sin(3 * M * rad)
    + 0.005 * Math.sin(4 * M * rad) + 0.0005 * Math.sin(5 * M * rad) + pbs;
  const ls = mod(aFMS + nuM, 360);
  const eot = 2.861 * Math.sin(2 * ls * rad) - 0.071 * Math.sin(4 * ls * rad) + 0.002 * Math.sin(6 * ls * rad) - nuM; // degrees
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mst = mod(24 * msd, 24);                    // Mean solar time at the prime meridian, hours
  const ltst = lonE => mod(mst + lonE / 15 + eot / 15, 24);
  return { ls, msd, mst, ltst, eot };
}

export function season(ls) {
  const n = ['spring', 'summer', 'autumn', 'winter'][Math.floor(ls / 90)];
  const s = ['autumn', 'winter', 'spring', 'summer'][Math.floor(ls / 90)];
  return `Northern ${n} · southern ${s}`;
}

export const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

const num = v => (v === '--' || v == null || v === '' ? null : +v);
const med = a => { const v = a.filter(x => x != null && isFinite(x)).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };

/** 36 bins of 10° Ls with median REMS values (computed once from the full feed). */
export function remsClimatology(soles) {
  const bins = Array.from({ length: 36 }, () => ({ min: [], max: [], p: [], gmin: [], gmax: [] }));
  let first = null, last = null;
  for (const s of soles) {
    const ls = num(s.ls); if (ls == null) continue;
    const b = bins[Math.floor(mod(ls, 360) / 10)];
    b.min.push(num(s.min_temp)); b.max.push(num(s.max_temp)); b.p.push(num(s.pressure));
    b.gmin.push(num(s.min_gts_temp)); b.gmax.push(num(s.max_gts_temp));
    const d = s.terrestrial_date; if (d) { if (!first || d < first) first = d; if (!last || d > last) last = d; }
  }
  return {
    from: first, to: last,
    bins: bins.map(b => ({ n: b.min.filter(x => x != null).length, min: med(b.min), max: med(b.max), p: med(b.p), gmin: med(b.gmin), gmax: med(b.gmax) })),
  };
}

export function expectedNow(clim, ls) {
  if (!clim) return null;
  const b = clim.bins[Math.floor(mod(ls, 360) / 10)];
  return b && b.n ? b : null;
}
