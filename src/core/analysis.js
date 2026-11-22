// Pure analysis functions (no DOM). Sample points are {t (ms), x, y} as offsets from stick center.
export const CFG = { dz: 23, smash: 64, full: 80, rel: 50 };
export const hyp = (x, y) => Math.sqrt(x * x + y * y);
export const angleOf = (x, y) => { const a = Math.atan2(y, x) * 180 / Math.PI; return a < 0 ? a + 360 : a; };
export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
export const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };
export const DIRS = ['Right', 'Up-right', 'Up', 'Up-left', 'Left', 'Down-left', 'Down', 'Down-right'];
export const dirName = a => DIRS[Math.round(a / 45) % 8];
export const angDiff = (a, b) => ((a - b) % 360 + 540) % 360 - 180;
export const rnd = (v, n = 1) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);
const worst = list => list.includes('bad') ? 'bad' : list.includes('warn') ? 'warn' : 'ok';

export function analyzeRest(pts) {
  if (!pts.length) return { enough: false };
  const t0 = pts[0].t;
  const use = pts.filter(p => p.t - t0 >= 200);
  if (use.length < 30) return { enough: false };
  const xs = use.map(p => p.x), ys = use.map(p => p.y);
  const mx = mean(xs), my = mean(ys), sx = std(xs), sy = std(ys);
  let maxR = 0;
  for (const p of use) maxR = Math.max(maxR, hyp(p.x, p.y));
  const off = hyp(mx, my);
  const status = (off > 5 || maxR > 20) ? 'bad' : (off > 2 || sx > 1.5 || sy > 1.5 || maxR > 8) ? 'warn' : 'ok';
  return { enough: true, n: use.length, meanX: mx, meanY: my, offset: off, stdX: sx, stdY: sy, maxR, status };
}

export function analyzeRotation(pts) {
  const rs = pts.map(p => hyp(p.x, p.y));
  let maxR = 0;
  for (const r of rs) maxR = Math.max(maxR, r);
  if (pts.length < 100 || maxR < 50) return { enough: false, maxR };
  const notches = [];
  for (let k = 0; k < 8; k++) {
    const cand = [];
    let binMax = 0;
    for (let i = 0; i < pts.length; i++) {
      if (rs[i] < 0.5 * maxR) continue;
      const a = angleOf(pts[i].x, pts[i].y);
      if (Math.abs(angDiff(a, k * 45)) <= 10) {
        cand.push({ x: pts[i].x, y: pts[i].y, r: rs[i] });
        if (rs[i] > binMax) binMax = rs[i];
      }
    }
    const sel = cand.filter(c => c.r >= binMax - 2);
    if (!sel.length) { notches.push({ k, name: DIRS[k], missing: true }); continue; }
    const x = mean(sel.map(c => c.x)), y = mean(sel.map(c => c.y));
    const a = angleOf(x, y);
    notches.push({ k, name: DIRS[k], x, y, r: hyp(x, y), angle: a, angErr: angDiff(a, k * 45) });
  }
  const have = notches.filter(n => !n.missing);
  const missing = notches.filter(n => n.missing).map(n => n.name);
  const card = have.filter(n => n.k % 2 === 0);
  const diag = have.filter(n => n.k % 2 === 1);
  const cr = card.map(n => n.r);
  const asym = cr.length > 1 ? Math.max(...cr) - Math.min(...cr) : 0;
  const maxDiagErr = diag.length ? Math.max(...diag.map(n => Math.abs(n.angErr))) : 0;
  const offAxis = card.map(n => (n.k % 4 === 0) ? Math.abs(n.y) : Math.abs(n.x));
  const maxOff = offAxis.length ? Math.max(...offAxis) : 0;
  const sAsym = asym > 12 ? 'bad' : asym > 6 ? 'warn' : 'ok';
  const sDiag = maxDiagErr > 6 ? 'bad' : maxDiagErr > 3 ? 'warn' : 'ok';
  const sOff = maxOff > 8 ? 'bad' : maxOff > 4 ? 'warn' : 'ok';
  const sMiss = missing.length ? 'warn' : 'ok';
  return {
    enough: true, maxR, notches, missing, asym, maxDiagErr, maxOff, sAsym, sDiag, sOff, sMiss,
    status: worst([sAsym, sDiag, sOff, sMiss])
  };
}

export function analyzeReleases(pts) {
  const n = pts.length;
  if (n < 50) return { enough: false, events: [] };
  const rs = pts.map(p => hyp(p.x, p.y));
  const events = [];
  let i = 0;
  while (i < n) {
    if (rs[i] < CFG.rel) { i++; continue; }
    let last = i;
    while (i < n && rs[i] >= CFG.rel) { last = i; i++; }
    if (i >= n) break;
    let pk = last;
    for (let j = Math.max(0, last - 6); j <= last; j++) if (rs[j] > rs[pk]) pk = j;
    const ux = pts[pk].x / rs[pk], uy = pts[pk].y / rs[pk];
    let m = -1;
    for (let j = i; j < n && pts[j].t - pts[last].t <= 100; j++) {
      if (pts[j].x * ux + pts[j].y * uy <= 10) { m = j; break; }
    }
    if (m < 0) continue; // slow return, not a release
    let opp = 0, oppAt = 0, end = m;
    for (let j = m; j < n && pts[j].t - pts[m].t <= 120; j++) {
      end = j;
      const p = -(pts[j].x * ux + pts[j].y * uy);
      if (p > opp) { opp = p; oppAt = pts[j].t - pts[m].t; }
    }
    events.push({ dir: dirName(angleOf(ux, uy)), peak: rs[pk], opposite: opp, oppAt, tToCenter: pts[m].t - pts[last].t });
    i = end + 1;
  }
  if (events.length < 2) return { enough: false, events };
  const opps = events.map(e => e.opposite);
  const worstOpp = Math.max(...opps);
  const byDir = {};
  for (const e of events) (byDir[e.dir] = byDir[e.dir] || []).push(e.opposite);
  const dirs = Object.keys(byDir).map(d => ({ dir: d, n: byDir[d].length, worst: Math.max(...byDir[d]), mean: mean(byDir[d]) }));
  const status = worstOpp >= CFG.dz ? 'bad' : worstOpp >= 10 ? 'warn' : 'ok';
  return { enough: true, events, count: events.length, worstOpp, meanOpp: mean(opps), dirs, status };
}

export function analyzeFlicks(pts) {
  const n = pts.length;
  if (n < 50) return { enough: false, events: [] };
  const rs = pts.map(p => hyp(p.x, p.y));
  const events = [];
  let armed = true;
  for (let i = 0; i < n; i++) {
    if (rs[i] < 10) { armed = true; continue; }
    if (armed && rs[i] >= CFG.dz) {
      armed = false;
      let reach = -1, peak = rs[i], pkIdx = i;
      for (let j = i; j < n && pts[j].t - pts[i].t <= 150; j++) {
        if (rs[j] > peak) { peak = rs[j]; pkIdx = j; }
        if (reach < 0 && rs[j] >= CFG.smash) reach = j;
      }
      events.push({ peak, dir: dirName(angleOf(pts[pkIdx].x, pts[pkIdx].y)), reached: reach >= 0, tToSmash: reach >= 0 ? pts[reach].t - pts[i].t : null });
    }
  }
  if (events.length < 3) return { enough: false, events };
  const reached = events.filter(e => e.reached).length;
  const frac = reached / events.length;
  const peaks = events.map(e => e.peak).sort((a, b) => a - b);
  const medPeak = peaks[Math.floor(peaks.length / 2)];
  const status = frac < 0.6 ? 'bad' : frac < 0.9 ? 'warn' : 'ok';
  return { enough: true, events, count: events.length, reached, frac, medPeak, status };
}

export function runAnalyses(mode, pts) {
  const out = {};
  if (mode === 'rest') out.rest = analyzeRest(pts);
  if (mode === 'rotate' || mode === 'free') out.rotation = analyzeRotation(pts);
  if (mode === 'release' || mode === 'free') out.releases = analyzeReleases(pts);
  if (mode === 'flick' || mode === 'free') out.flicks = analyzeFlicks(pts);
  return out;
}

export function summarize(results) {
  const s = {};
  if (results.rest && results.rest.enough) {
    const r = results.rest;
    s.rest = { status: r.status, meanOffset: [rnd(r.meanX), rnd(r.meanY)], std: [rnd(r.stdX, 2), rnd(r.stdY, 2)], maxRadius: rnd(r.maxR) };
  }
  if (results.rotation && results.rotation.enough) {
    const r = results.rotation;
    s.rotation = {
      status: r.status, maxRadius: rnd(r.maxR), cardinalRadiusSpread: rnd(r.asym), worstDiagonalAngleErrorDeg: rnd(r.maxDiagErr), worstCardinalOffAxis: rnd(r.maxOff),
      missingNotches: r.missing,
      notches: r.notches.filter(n => !n.missing).map(n => ({ name: n.name, x: rnd(n.x), y: rnd(n.y), radius: rnd(n.r), angleErrDeg: rnd(n.angErr) }))
    };
  }
  if (results.releases && results.releases.enough) {
    const r = results.releases;
    s.releases = { status: r.status, count: r.count, worstOppositeOvershoot: rnd(r.worstOpp), meanOppositeOvershoot: rnd(r.meanOpp), perDirection: r.dirs.map(d => ({ dir: d.dir, n: d.n, worst: rnd(d.worst), mean: rnd(d.mean) })), deadzoneEdge: CFG.dz };
  }
  if (results.flicks && results.flicks.enough) {
    const r = results.flicks;
    s.flicks = { status: r.status, count: r.count, fractionReachingSmashThreshold: rnd(r.frac, 2), medianPeak: rnd(r.medPeak), smashThreshold: CFG.smash };
  }
  return s;
}

/* ---- checks used by walkthrough steps ---- */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null) ? undefined : o[k], obj);
}
const OPS = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '>': (a, b) => a > b, '==': (a, b) => a === b };

// spec: {label, path, op, value}. A check on an analysis that had too little data is "missing" and fails.
export function evalChecks(specs, results) {
  return specs.map(s => {
    const top = s.path.split('.')[0];
    const block = results ? results[top] : undefined;
    const v = block && block.enough === false ? undefined : getPath(results || {}, s.path);
    if (typeof v !== 'number') return { label: s.label, pass: false, missing: true, op: s.op, target: s.value };
    return { label: s.label, pass: OPS[s.op](v, s.value), value: v, op: s.op, target: s.value };
  });
}

/* ---- history / before-after ---- */
export const METRICS = [
  { key: 'rest.offset', label: 'Neutral offset', lower: true },
  { key: 'rotation.maxDiagErr', label: 'Diagonal angle error (°)', lower: true },
  { key: 'rotation.asym', label: 'Cardinal reach spread', lower: true },
  { key: 'rotation.maxOff', label: 'Cardinal off-axis', lower: true },
  { key: 'releases.worstOpp', label: 'Worst release overshoot', lower: true },
  { key: 'releases.meanOpp', label: 'Mean release overshoot', lower: true },
  { key: 'flicks.frac', label: 'Flicks reaching smash threshold', lower: false }
];
export function metricsOf(results) {
  const m = {};
  for (const { key } of METRICS) {
    const block = results[key.split('.')[0]];
    if (!block || block.enough === false) continue;
    const v = getPath(results, key);
    if (typeof v === 'number') m[key] = rnd(v, 2);
  }
  return m;
}
export function diffMetrics(before, after) {
  const out = [];
  for (const { key, label, lower } of METRICS) {
    if (typeof before[key] !== 'number' || typeof after[key] !== 'number') continue;
    const delta = rnd(after[key] - before[key], 2);
    const better = delta === 0 ? null : lower ? delta < 0 : delta > 0;
    out.push({ key, label, before: before[key], after: after[key], delta, better });
  }
  return out;
}
