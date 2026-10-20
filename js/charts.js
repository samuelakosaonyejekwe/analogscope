// Lightweight SVG charts (no external libraries).

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Radar of per-criterion scores (0..1). */
export function radar(rows, { size = 240, color = 'var(--accent)' } = {}) {
  const pts = rows.filter(r => r.s != null);
  if (pts.length < 3) return '';
  const c = size / 2, R = size / 2 - 38, n = pts.length;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const xy = (i, r) => [c + Math.cos(ang(i)) * r, c + Math.sin(ang(i)) * r];
  let grid = '';
  for (const f of [0.25, 0.5, 0.75, 1]) grid += `<polygon points="${pts.map((_, i) => xy(i, R * f).join(',')).join(' ')}" class="rg"/>`;
  const axes = pts.map((p, i) => { const [x, y] = xy(i, R); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" class="rg"/>`; }).join('');
  const shape = pts.map((p, i) => xy(i, R * Math.max(0.03, p.s)).join(',')).join(' ');
  const labels = pts.map((p, i) => {
    const [x, y] = xy(i, R + 16), a = Math.cos(ang(i));
    return `<text x="${x}" y="${y}" text-anchor="${a > 0.3 ? 'start' : a < -0.3 ? 'end' : 'middle'}" dominant-baseline="middle" class="rl">${esc(p.short)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Per-factor match radar">${grid}${axes}<polygon points="${shape}" style="fill:${color};stroke:${color}" class="rs"/>${labels}</svg>`;
}

/** Month-by-month bars with the best months highlighted. */
export function monthBars(data, { h = 70 } = {}) {
  if (!data) return '';
  const max = 100, bw = 100 / 12;
  const top = [...data].filter(d => d.score != null).sort((a, b) => b.score - a.score).slice(0, 3).map(d => d.m);
  return `<svg viewBox="0 0 100 ${h + 12}" preserveAspectRatio="none" class="mbars" role="img" aria-label="Analog score by month">${data.map((d, i) => {
    const v = d.score ?? 0, bh = v / max * h;
    return `<rect x="${i * bw + 0.8}" y="${h - bh}" width="${bw - 1.6}" height="${bh}" rx="1" class="${top.includes(d.m) ? 'mb-top' : 'mb'}"><title>${d.m}: ${d.score ?? '–'}</title></rect><text x="${i * bw + bw / 2}" y="${h + 9}" text-anchor="middle" class="ml">${d.m[0]}</text>`;
  }).join('')}</svg>`;
}

/** Sparkline with optional reference (climatology) line. */
export function spark(values, { w = 220, h = 46, ref = null, unit = '' } = {}) {
  const v = values.map((x, i) => [i, x]).filter(p => p[1] != null);
  if (v.length < 2) return '<span class="muted">not enough recent data</span>';
  const ys = v.map(p => p[1]).concat(ref != null ? [ref] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const X = i => i / (values.length - 1) * (w - 4) + 2, Y = y => h - 4 - (y - lo) / span * (h - 8);
  const d = v.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const last = v[v.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Recent trend">${ref != null ? `<line x1="0" x2="${w}" y1="${Y(ref)}" y2="${Y(ref)}" class="sp-ref"><title>Long-term normal: ${ref.toFixed(1)} ${esc(unit)}</title></line>` : ''}<path d="${d}" class="sp-line"/><circle cx="${X(last[0])}" cy="${Y(last[1])}" r="2.6" class="sp-dot"/></svg>`;
}

/** Circular score gauge. */
export function gauge(score, { size = 92, label = '' } = {}) {
  const r = size / 2 - 7, C = 2 * Math.PI * r, f = score == null ? 0 : score / 100;
  return `<svg viewBox="0 0 ${size} ${size}" class="gauge" role="img" aria-label="${esc(label)} ${score ?? 'no data'} out of 100">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="gg-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="gg-fg" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="gg-t">${score ?? '–'}</text></svg>`;
}

/** Simple line chart for a series of [time, value] pairs, log scale optional. */
export function lineChart(pts, { w = 320, h = 90, log = false, bands = [] } = {}) {
  const v = pts.filter(p => p[1] != null && (!log || p[1] > 0));
  if (v.length < 2) return '';
  const f = log ? Math.log10 : x => x;
  const ys = v.map(p => f(p[1])).concat(bands.map(b => f(b.v)));
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const t0 = v[0][0], t1 = v[v.length - 1][0];
  const X = t => (t - t0) / (t1 - t0 || 1) * (w - 6) + 3, Y = y => h - 4 - (f(y) - lo) / span * (h - 10);
  const d = v.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const b = bands.map(b => `<line x1="0" x2="${w}" y1="${Y(b.v)}" y2="${Y(b.v)}" class="sp-ref"/><text x="${w - 2}" y="${Math.max(9, Y(b.v) - 2)}" text-anchor="end" class="ml">${esc(b.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="line" role="img" aria-label="Time series">${b}<path d="${d}" class="sp-line"/></svg>`;
}
