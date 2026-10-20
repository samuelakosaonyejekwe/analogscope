// Analog scoring engine.
// Environmental Analog Index (EAI): weighted fit of measured variables to a target.
// Geologic Context Score (GCS): overlap between a site's documented geology and the target's.
// Analog Fidelity Score (AFS) blends the two when geology is known.

import { TARGETS, VARIABLES, GEOLOGY, MISSIONS } from './targets.js';
import { MONTHS } from './data.js';

const smooth = x => x * x * (3 - 2 * x);

export function criterionScore(c, x) {
  if (x == null || !isFinite(x)) return null;
  const t = (x - c.worst) / (c.best - c.worst);
  return smooth(Math.max(0, Math.min(1, t)));
}

function weights(target, mission) {
  const m = MISSIONS[mission] || MISSIONS.balanced;
  return target.criteria.map(c => ({ ...c, w: c.w * (m.mult[c.v] ?? 1) }));
}

export function environmental(target, vals, mission = 'balanced') {
  const rows = weights(target, mission).map(c => {
    const s = criterionScore(c, vals[c.v]);
    return { ...c, x: vals[c.v] ?? null, s };
  });
  let sw = 0, swAll = 0, acc = 0;
  for (const r of rows) { swAll += r.w; if (r.s != null) { sw += r.w; acc += r.w * r.s; } }
  return { score: sw ? acc / sw : null, coverage: swAll ? sw / swAll : 0, rows };
}

export function geologic(target, tags, mission = 'balanced') {
  if (!tags || !tags.length) return null;
  const boost = new Set(MISSIONS[mission]?.geoBoost || []);
  const base = [1, 0.8, 0.65, 0.5];
  let tot = 0, hit = 0;
  const matched = [];
  target.geo.forEach((g, i) => {
    const w = (base[i] ?? 0.4) * (boost.has(g) ? 1.5 : 1);
    tot += w;
    if (tags.includes(g)) { hit += w; matched.push(g); }
  });
  return { score: tot ? hit / tot : 0, matched, missing: target.geo.filter(g => !tags.includes(g)) };
}

export function evaluate(target, vals, tags, mission = 'balanced') {
  const env = environmental(target, vals, mission);
  const geo = geologic(target, tags, mission);
  const gw = target.geoWeight ?? 0.35;
  let score = env.score;
  // Cave targets cannot be judged from climate alone: without known geology,
  // cap the score at the environmental share so it never reads as a strong analog.
  const geoRequired = !geo && gw >= 0.5;
  if (geo && env.score != null) score = env.score * (1 - gw) + geo.score * gw;
  else if (geo) score = geo.score;
  else if (geoRequired && score != null) score = score * (1 - gw);
  return { target, score: score == null ? null : Math.round(score * 100), env, geo, geoRequired, confidence: Math.round(env.coverage * 100) };
}

export function rankTargets(vals, tags, mission) {
  return TARGETS.map(t => evaluate(t, vals, tags, mission)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** Monthly analog scores, used to suggest the best months for a field campaign. */
export function monthly(target, profile, tags, mission) {
  if (!profile.months) return null;
  return MONTHS.map((m, i) => {
    const vals = { ...profile.ann };
    for (const [k, arr] of Object.entries(profile.months)) if (arr[i] != null) vals[k] = arr[i];
    return { m, score: evaluate(target, vals, tags, mission).score };
  });
}

/** Re-score using the last 30 days of observations instead of long-term normals. */
export function liveScore(target, profile, recent, tags, mission) {
  if (!recent?.series) return null;
  const s = recent.series, n = s.T2M.length, from = Math.max(0, n - 30);
  const mean = a => { const v = a.slice(from).filter(x => x != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const vals = { ...profile.ann };
  const set = (k, v) => { if (v != null) vals[k] = v; };
  set('T2M', mean(s.T2M));
  const mx = mean(s.T2M_MAX), mn = mean(s.T2M_MIN);
  if (mx != null && mn != null) vals.T2M_RANGE = mx - mn;
  const pr = mean(s.PRECTOTCORR); if (pr != null) vals.PRECIP = pr * 365;
  set('RH2M', mean(s.RH2M)); set('UV', mean(s.ALLSKY_SFC_UV_INDEX)); set('SOLAR', mean(s.ALLSKY_SFC_SW_DWN));
  set('WIND', mean(s.WS2M)); set('CLOUD', mean(s.CLOUD_AMT)); set('PS', mean(s.PS));
  return { ...evaluate(target, vals, tags, mission), vals };
}

/** Short explanation of what drives a score. */
export function explain(ev) {
  const rows = ev.env.rows.filter(r => r.s != null);
  const strong = rows.filter(r => r.s >= 0.7).sort((a, b) => b.w * b.s - a.w * a.s).slice(0, 3);
  const weak = rows.filter(r => r.s < 0.4).sort((a, b) => b.w * (1 - b.s) - a.w * (1 - a.s)).slice(0, 2);
  const lbl = r => VARIABLES[r.v].label.toLowerCase();
  const parts = [];
  if (strong.length) parts.push(`Strong match on ${strong.map(lbl).join(', ')}.`);
  if (weak.length) parts.push(`Weakest on ${weak.map(lbl).join(' and ')}.`);
  if (ev.geo) {
    if (ev.geo.matched.length) parts.push(`Shares geology with the target: ${ev.geo.matched.map(g => GEOLOGY[g].toLowerCase()).join(', ')}.`);
    else parts.push('None of its documented geology matches this target.');
  } else if (ev.geoRequired) parts.push('This target depends on lava tubes or caves, which satellites cannot confirm, so the score is capped until caves are documented here. If you know there are caves, add lava tubes under Geology.');
  else parts.push('No geology documented for this point, so the score uses environmental data only.');
  return parts.join(' ');
}

export function grade(s) {
  if (s == null) return { label: 'No data', cls: 'g-none' };
  if (s >= 80) return { label: 'Exceptional analog', cls: 'g-a' };
  if (s >= 65) return { label: 'Strong analog', cls: 'g-b' };
  if (s >= 50) return { label: 'Moderate analog', cls: 'g-c' };
  if (s >= 35) return { label: 'Weak analog', cls: 'g-d' };
  return { label: 'Poor analog', cls: 'g-e' };
}
