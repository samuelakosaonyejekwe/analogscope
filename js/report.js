// Site report: full characterisation of a documented site or any tapped point.
import { state, set, target, site, siteProfile, toast, fmt, ago, scoreColor, scoreText, mark } from './state.js';
import { TARGETS, VARIABLES, GEOLOGY, MISSIONS, GAPS, PLANET } from './targets.js';
import { caveEvidence, LEVEL_TEXT } from './evidence.js';
import { evaluate, rankTargets, monthly, liveScore, explain, grade } from './engine.js';
import { profile, powerRecent, live, haversine, LC_NAMES, store } from './data.js';
import { radar, monthBars, spark, gauge, esc, safeUrl } from './charts.js';

let token = 0;

export function placeOf(sel) {
  if (sel.kind === 'site') { const s = site(sel.id); return s ? { ...s, tags: s.geo, documented: true } : null; }
  const key = `${sel.lat.toFixed(2)},${sel.lon.toFixed(2)}`;
  const saved = state.candidates.find(c => Math.abs(c.lat - sel.lat) < 0.005 && Math.abs(c.lon - sel.lon) < 0.005);
  return { id: 'pt:' + key, name: saved?.name || 'Selected location', region: `${sel.lat.toFixed(3)}°, ${sel.lon.toFixed(3)}°`, lat: sel.lat, lon: sel.lon, tags: state.customGeo[key] || [], documented: false, key };
}

export async function renderReport(el, sel) {
  const my = ++token;
  const place = placeOf(sel);
  if (!place) { el.innerHTML = '<p class="empty">Site not found.</p>'; return; }
  let p = place.documented ? siteProfile(place.id) : null;
  el.innerHTML = header(place) + (p ? '' : skeleton());
  // Cave evidence comes from bundled data, so it is available offline.
  place.evidence = await caveEvidence(place.lat, place.lon).catch(() => null);
  if (my !== token) return;
  if (p) draw(el, place, p);
  // Refresh from NASA/JAXA in the background (normals are cached for 30 days).
  try {
    const fresh = await profile(place.lat, place.lon, { fallback: p });
    mark('NASA POWER', fresh.sources.power); mark('SRTM terrain', fresh.sources.terrain); mark('JAXA Earth API', fresh.sources.jaxa);
    if (my !== token) return;
    if (!p || fresh.t !== p.t) { p = fresh; draw(el, place, p); }
  } catch (e) {
    if (my !== token) return;
    if (!p) { el.innerHTML = header(place) + `<div class="card empty">${esc(e.message)}<br>Connect to the internet once to download data for new locations. Documented sites work offline.</div>`; return; }
  }
  if (my !== token) return;
  loadLive(el, place, p, my);
}

function header(pl) {
  return `<div class="card">
    <h2 class="site-title">${esc(pl.name)}</h2>
    <div class="site-sub">${esc(pl.region)}${pl.documented ? ` · ${pl.lat.toFixed(2)}°, ${pl.lon.toFixed(2)}°` : ''}</div>
    ${pl.documented ? `<p style="margin:0 0 6px">${esc(pl.note)}</p><div class="muted" style="font-size:12.5px">Used by: ${esc(pl.programs)}</div>` : '<p class="muted" style="margin:0">A location without published analog studies. The scores below come from satellite and reanalysis data only. If you know the local geology, add it below to include it in the score.</p>'}
  </div>`;
}
const skeleton = () => `<div class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div><p class="muted" style="font-size:13px">Fetching NASA POWER, JAXA and terrain data…</p></div>`;

function draw(el, place, p) {
  const t = target();
  const evi = place.evidence?.tags;
  const ev = evaluate(t, p.ann, place.tags, state.mission, evi);
  const g = grade(ev.score);
  const all = rankTargets(p.ann, place.tags, state.mission, evi);
  const mon = monthly(t, p, place.tags, state.mission, evi);
  const best = mon ? [...mon].filter(m => m.score != null).sort((a, b) => b.score - a.score).slice(0, 3).map(m => m.m) : [];
  const rows = ev.env.rows.map(r => ({ ...r, short: VARIABLES[r.v].short }));
  const color = t.body === 'mars' ? 'var(--mars)' : 'var(--moon)';
  el.innerHTML = header(place) + `
  <div class="card ${g.cls}">
    <div class="hero">${gauge(ev.score, { label: t.name + ' score' })}
      <div><div class="muted" style="font-size:12.5px">How well it stands in for</div>
        <div style="font-weight:700">${esc(t.name)} <span class="muted" style="font-weight:500">· ${esc(MISSIONS[state.mission].label)}</span></div>
        <div class="grade">${g.label}</div>
        <div class="subscores"><span>Environment <b>${ev.env.score == null ? '–' : Math.round(ev.env.score * 100)}</b></span>${ev.geo ? `<span>Geology <b>${Math.round(ev.geo.score * 100)}</b></span>` : ''}<span>Data coverage <b>${ev.confidence}%</b></span></div>
      </div></div>
    <p class="explain">${esc(explain(ev))}</p>
    <div id="liveScore"></div>
  </div>

  <div class="card"><h3>Best match by target <span class="muted tag">tap to switch</span></h3>
    <div class="rows">${all.map(a => `<button class="cand" data-target="${a.target.id}" style="padding:6px 10px;margin:0"><span class="sc" style="color:${scoreText(a.score)}">${a.score ?? '–'}</span><span><b>${esc(a.target.name)}</b><div class="meta">${a.target.body === 'moon' ? 'Moon' : 'Mars'} · ${esc(a.target.short)}</div></span></button>`).join('')}</div>
  </div>

  <div class="card"><h3>Factor fit <span class="tag">${rows.filter(r => r.s != null).length}/${rows.length} measured</span></h3>
    ${radar(rows, { color })}
    <div class="rows" style="margin-top:8px">${rows.map(r => {
      const V = VARIABLES[r.v];
      return `<div class="frow"><span class="nm">${esc(V.label)}</span><span class="val">${r.x == null ? 'no data' : fmt(r.x, V.dp) + ' ' + V.unit}</span>
      <span class="meter"><i style="width:${r.s == null ? 0 : Math.round(r.s * 100)}%;background:${scoreColor(r.s == null ? null : r.s * 100)}"></i></span>
      <span class="src">Target ≈ ${fmt(r.best, V.dp)} ${V.unit} · weight ${fmt(r.w, 1)} · ${esc(V.src)}</span></div>`;
    }).join('')}</div>
  </div>

  <div class="card"><h3>Geology ${place.documented ? '' : '<span class="tag">tap to add what you know</span>'}</h3>
    <div>${(place.documented ? Object.keys(GEOLOGY).filter(k => place.tags.includes(k) || t.geo.includes(k)) : Object.keys(GEOLOGY).filter(k => k !== 'lavaprone')).map(k => {
      const has = place.tags.includes(k), want = t.geo.includes(k);
      return place.documented
        ? `<span class="tag ${has && want ? 'hit' : ''}" title="${want ? 'Target geology' : ''}">${has ? '✓ ' : '○ '}${esc(GEOLOGY[k])}</span>`
        : `<button type="button" class="tag ${has ? 'hit' : ''}" data-geo="${k}" aria-pressed="${has}" style="cursor:pointer">${has ? '✓ ' : '+ '}${esc(GEOLOGY[k])}${want ? ' ★' : ''}</button>`;
    }).join('')}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">✓ present at this site · ★/○ geology the target needs${p.ann.LC != null ? ` · ESA land cover: <b>${esc(LC_NAMES[p.ann.LC] || p.ann.LC)}</b>` : ''}</div>
    ${evidenceHtml(place.evidence)}
  </div>

  ${gapsHtml(t, p, ev)}

  <div class="card"><h3>When to run a field campaign</h3>
    ${mon ? monthBars(mon) + `<p style="margin:6px 0 0;font-size:13.5px">Conditions match <b>${esc(t.name)}</b> most closely in <b>${best.join(', ')}</b>, based on NASA POWER monthly normals for 2001–2020.</p>` : '<p class="muted">Monthly data not available.</p>'}
  </div>

  <div class="card" id="liveCard"><h3>Live field conditions <span class="tag">NASA POWER daily</span></h3><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div>
  <div class="card" id="hazCard"><h3>Live hazards nearby <span class="tag">NASA EONET · USGS</span></h3><div class="skeleton"></div></div>
  ${place.documented ? `<div class="card" id="imgCard"><h3>From NASA's image library</h3><div class="skeleton"></div></div>` : ''}

  <div class="card"><h3>Actions</h3><div class="actions">
    <a class="btn" href="#/twin?s=${place.documented ? place.id : ''}&t=${t.id}" ${place.documented ? '' : 'hidden'}>Open twin view</a>
    ${place.documented ? '' : `<button class="btn" data-act="save">★ Save as candidate</button>`}
    <button class="btn" data-act="share">Share link</button>
    <button class="btn" data-act="json">Download data (JSON)</button>
    <button class="btn" data-act="print">Print report</button>
  </div><p class="muted" style="font-size:12px;margin:8px 0 0">Data fetched ${ago(p.t)}${p.t ? ' (' + new Date(p.t).toLocaleDateString() + ')' : ''}.</p></div>`;

  el.querySelectorAll('[data-target]').forEach(b => b.onclick = () => set({ target: b.dataset.target }));
  el.querySelectorAll('[data-geo]').forEach(b => b.onclick = () => {
    const cur = new Set(state.customGeo[place.key] || []);
    cur.has(b.dataset.geo) ? cur.delete(b.dataset.geo) : cur.add(b.dataset.geo);
    set({ customGeo: { ...state.customGeo, [place.key]: [...cur] } });
  });
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, place, p, ev));
}

async function loadLive(el, place, p, my) {
  const t = target();
  // Recent observations
  powerRecent(place.lat, place.lon).then(rec => {
    if (my !== token) return;
    mark('NASA POWER daily', true);
    store.set(`r:${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, { t: Date.now(), rec });
    paintLive(el, place, p, rec, t, false);
  }).catch(() => {
    mark('NASA POWER daily', false);
    const c = store.get(`r:${place.lat.toFixed(2)},${place.lon.toFixed(2)}`);
    if (my !== token) return;
    if (c) paintLive(el, place, p, c.rec, t, c.t);
    else { const lc = el.querySelector('#liveCard'); if (lc) lc.innerHTML = '<h3>Live field conditions</h3><p class="muted">Offline. Recent daily data will appear the next time you are online.</p>'; }
  });
  // Hazards
  Promise.allSettled([live('eonet', null, 15 * 6e4), live('quakes', null, 15 * 6e4)]).then(([e, q]) => {
    if (my !== token) return;
    const hc = el.querySelector('#hazCard'); if (!hc) return;
    const items = [];
    if (e.status === 'fulfilled') {
      mark('NASA EONET', !e.value.cached);
      for (const x of e.value.data.events) {
        if (!x.g || x.g.type !== 'Point') continue;
        const d = haversine(place.lat, place.lon, x.g.c[1], x.g.c[0]);
        if (d < 600) items.push({ d, html: `<b>${esc(x.title)}</b> · ${esc(x.catTitle)} · ${Math.round(d)} km away · ${esc(new Date(x.g.date).toLocaleDateString())}` });
      }
    }
    if (q.status === 'fulfilled') {
      mark('USGS earthquakes', !q.value.cached);
      for (const x of q.value.data.features) {
        const d = haversine(place.lat, place.lon, x.c[1], x.c[0]);
        if (d < 400) items.push({ d, html: `<b>M${fmt(x.mag, 1)} earthquake</b> · ${esc(x.place)} · ${Math.round(d)} km · ${esc(new Date(x.time).toLocaleDateString())}` });
      }
    }
    items.sort((a, b) => a.d - b.d);
    hc.innerHTML = `<h3>Live hazards nearby <span class="tag">NASA EONET · USGS</span></h3>` + (items.length
      ? `<ul class="list">${items.slice(0, 8).map(i => `<li><span class="dot"></span><span>${i.html}</span></li>`).join('')}</ul>`
      : `<p style="margin:0" class="ok">No active natural events within 600 km and no M4.5+ earthquakes within 400 km in the past week.</p>`) +
      `<p class="muted" style="font-size:12px;margin:6px 0 0">Checked ${e.status === 'fulfilled' ? ago(e.value.t) : 'when offline'}. Review these before planning fieldwork.</p>`;
  });
  // NASA image library
  if (place.documented) {
    live('images', place.name.split('(')[0].trim(), 7 * 864e5).then(({ data }) => {
      if (my !== token) return;
      const ic = el.querySelector('#imgCard'); if (!ic) return;
      const its = data.items.filter(i => i.thumb).slice(0, 6);
      const its2 = its.filter(i => safeUrl(i.thumb));
      ic.innerHTML = `<h3>From NASA's image library</h3>` + (its2.length ? `<div class="thumbs">${its2.map(i => `<a href="https://images.nasa.gov/details/${encodeURIComponent(i.id)}" target="_blank" rel="noopener" title="${esc(i.title)}"><img loading="lazy" decoding="async" src="${esc(safeUrl(i.thumb))}" alt="${esc(i.title)}"></a>`).join('')}</div>` : '<p class="muted" style="margin:0">No archive images matched this site name.</p>');
      mark('NASA Image Library', true);
    }).catch(() => { const ic = el.querySelector('#imgCard'); if (ic) ic.remove(); });
  }
}

function paintLive(el, place, p, rec, t, cachedAt) {
  const lc = el.querySelector('#liveCard'); if (!lc) return;
  const s = rec.series, n = s.T2M.length;
  const m = new Date().getUTCMonth();
  const normT = p.months?.T2M?.[m];
  const mean = (a, k = 30) => { const v = a.slice(-k).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const ls = liveScore(t, p, rec, place.tags, state.mission, place.evidence?.tags);
  const base = evaluate(t, p.ann, place.tags, state.mission, place.evidence?.tags).score;
  const d = ls?.score != null && base != null ? ls.score - base : null;
  const lastDate = rec.dates[rec.dates.length - 1];
  const nice = lastDate ? `${lastDate.slice(0, 4)}-${lastDate.slice(4, 6)}-${lastDate.slice(6)}` : '–';
  lc.innerHTML = `<h3>Live field conditions <span class="tag ${cachedAt ? 'stale' : 'live'}">${cachedAt ? 'saved ' + ago(cachedAt) : 'NASA POWER · to ' + nice}</span></h3>
    <div class="kv">
      <div><small>Last day air temp.</small><b>${fmt(s.T2M[n - 1], 1)} °C</b></div>
      <div><small>30-day mean vs normal</small><b>${fmt(mean(s.T2M), 1)} °C</b> <span class="muted">(${fmt(normT, 1)})</span></div>
      <div><small>30-day precipitation</small><b>${fmt((mean(s.PRECTOTCORR) ?? 0) * 30, 0)} mm</b></div>
      <div><small>30-day humidity</small><b>${fmt(mean(s.RH2M), 0)} %</b></div>
    </div>
    <div style="margin-top:10px"><small class="muted">Daily air temperature, last ${n} days (dashed line = long-term normal for this month)</small>${spark(s.T2M, { ref: normT, unit: '°C' })}</div>
    ${ls?.score != null ? `<p style="margin:8px 0 0;font-size:13.5px">Score using the last 30 days of weather: <b style="color:${scoreText(ls.score)}">${ls.score}</b> ${d != null ? `<span class="${d >= 0 ? 'delta-up' : 'delta-dn'}">(${d >= 0 ? '+' : ''}${d} vs long-term normal)</span>` : ''}</p>` : ''}`;
  const sc = el.querySelector('#liveScore');
  if (sc && ls?.score != null) sc.innerHTML = `<div class="tag ${cachedAt ? 'stale' : 'live'}" style="margin-top:8px">● Score from the last 30 days: ${ls.score}${d != null ? ` (${d >= 0 ? '+' : ''}${d})` : ''}</div>`;
}

function act(a, place, p, ev) {
  const t = target();
  if (a === 'share') {
    const url = location.origin + location.pathname + `#/map?t=${t.id}&` + (place.documented ? `s=${place.id}` : `p=${place.lat},${place.lon}`);
    if (navigator.share) navigator.share({ title: `AnalogScope · ${place.name}`, text: `${place.name}: ${ev.score}/100 as a ${t.name} analog`, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url, 6000));
  } else if (a === 'json') {
    const out = { app: 'AnalogScope', generated: new Date().toISOString(), place: { name: place.name, lat: place.lat, lon: place.lon, geology: place.tags }, target: t.name, mission: state.mission, score: ev.score, environmental: ev.env.score, geologic: ev.geo?.score ?? null, factors: ev.env.rows.map(r => ({ variable: r.v, label: VARIABLES[r.v].label, value: r.x, unit: VARIABLES[r.v].unit, fit: r.s, weight: r.w, source: VARIABLES[r.v].src })), allTargets: TARGETS.map(x => ({ target: x.name, score: evaluate(x, p.ann, place.tags, state.mission, place.evidence?.tags).score })), caveEvidence: place.evidence, data: p };
    const b = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(b), l = Object.assign(document.createElement('a'), { href: u, download: `analogscope-${(place.name || 'site').replace(/\W+/g, '-').toLowerCase()}.json` });
    l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  } else if (a === 'print') window.print();
  else if (a === 'save') {
    const name = (prompt('Name this candidate site:', `Candidate ${state.candidates.length + 1}`) || '').trim().slice(0, 80);
    if (!name) return;
    set({ candidates: [{ name, lat: place.lat, lon: place.lon, t: Date.now() }, ...state.candidates.filter(c => !(Math.abs(c.lat - place.lat) < 0.005 && Math.abs(c.lon - place.lon) < 0.005))].slice(0, 200) });
    toast('Saved to My candidates (stored on this device)');
  }
}

function evidenceHtml(e) {
  if (!e) return '';
  const lines = [];
  if (e.tube) lines.push(`Documented lava tube: <b>${esc(e.tube.name)}</b>, ${e.tube.km} km away${/^Q\d+$/.test(e.tube.ref) ? ` (<a href="https://www.wikidata.org/wiki/${e.tube.ref}" target="_blank" rel="noopener">Wikidata ${e.tube.ref}</a>)` : ''}`);
  if (e.effusive) lines.push(`Nearest lava-flow volcano: <b>${esc(e.effusive.name)}</b> (${esc(e.effusive.type)}${e.effusive.basaltic === 1 ? ', basaltic' : ''}, ${esc(e.effusive.epoch)}), ${e.effusive.km} km away`);
  else if (e.nearest) lines.push(`Nearest volcano: <b>${esc(e.nearest.name)}</b> (${esc(e.nearest.type)}), ${e.nearest.km} km away`);
  const cls = e.level === 'confirmed' ? 'ok' : e.level === 'none' ? 'muted' : 'warn';
  return `<div style="margin-top:10px;font-size:13px"><b>Cave evidence:</b> <span class="${cls}">${esc(LEVEL_TEXT[e.level])}</span>
    ${lines.length ? `<ul class="list" style="margin-top:4px">${lines.map(l => `<li><span class="dot" style="background:var(--accent)"></span><span>${l}</span></li>`).join('')}</ul>` : ''}
    <div class="muted" style="font-size:11.5px;margin-top:2px">Sources: Smithsonian Global Volcanism Program (2,666 volcanoes) and documented lava-tube caves from Wikidata. A documented tube confirms caves; a volcano only makes them likely, so it gets half credit. The cave targets use this evidence automatically.</div></div>`;
}

export function gapsHtml(t, p, ev) {
  const a = p.ann, rows = GAPS[t.body];
  const M = PLANET.mars, L = PLANET.moon;
  const site = g => {
    if (g.site === 'PS' && a.PS != null) return t.body === 'mars' ? `${fmt(a.PS, 1)} kPa here: about ${fmt(a.PS / M.pressureKPa, 0)}× denser than the Mars average` : `${fmt(a.PS, 1)} kPa here, nowhere near vacuum`;
    if (g.site === 'T2M' && a.T2M != null) return `${fmt(a.T2M, 1)} °C mean here: ${fmt(a.T2M - M.meanTempC, 0)} °C warmer than the Mars average`;
    if (g.site === 'LST_SWING') {
      if (a.LST_SWING != null) return `${fmt(a.LST_SWING, 1)} °C ground day–night swing here, vs ≈ ${L.surfaceSwingC} °C on the Moon`;
      if (a.T2M_RANGE != null) return `${fmt(a.T2M_RANGE, 1)} °C daily air swing here (no ground data), vs ≈ ${L.surfaceSwingC} °C surface swing on the Moon`;
    }
    return 'Not reproducible outdoors on Earth';
  };
  const good = ev.env.rows.filter(r => r.s != null && r.s >= 0.7).length, n = ev.env.rows.filter(r => r.s != null).length;
  return `<div class="card"><h3>What no Earth site can reproduce</h3>
    <p style="margin:0 0 8px;font-size:13.5px">This site matches <b>${good} of ${n}</b> measured factors well (fit ≥ 70 %). For the conditions below, missions combine field tests here with lab facilities:</p>
    <table class="cmp">${rows.map(g => `<tr><td><b>${esc(g.what)}</b><div class="muted" style="font-size:12px">${esc(t.body === 'moon' ? 'Moon' : 'Mars')}: ${esc(g.planet)}</div><div style="font-size:12px">${esc(site(g))}</div></td><td style="font-size:12.5px">${esc(g.lab)}</td></tr>`).join('')}</table></div>`;
}
