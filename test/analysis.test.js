import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRest, analyzeRotation, analyzeReleases, analyzeFlicks, runAnalyses, summarize, evalChecks, metricsOf, diffMetrics } from '../src/core/analysis.js';
import { localCoach } from '../src/core/coach.js';
import fw031 from '../src/data/firmware/fw031.js';

const DT = 8;
const noise = (s = 0.3) => (Math.random() - 0.5) * s;
const gateR = a => { const m = ((a % 45) + 45) % 45; return 100 * Math.cos(22.5 * Math.PI / 180) / Math.cos((m - 22.5) * Math.PI / 180); };

function rest(n = 400, ox = 0, oy = 0) { return Array.from({ length: n }, (_, i) => ({ t: i * DT, x: Math.round(ox + noise()), y: Math.round(oy + noise()) })); }
function rotation(skew = 0) {
  const pts = []; let t = 0;
  for (let lap = 0; lap < 2; lap++) for (let a = 0; a < 360; a++) {
    const ar = (Math.abs(a - 45) <= 2) ? a + skew : a, r = gateR(a);
    pts.push({ t: t += DT * 3, x: Math.cos(ar * Math.PI / 180) * r, y: Math.sin(ar * Math.PI / 180) * r });
  }
  return pts;
}
function releases(over) {
  const pts = []; let t = 0;
  for (let n = 0; n < 6; n++) {
    for (let i = 0; i < 60; i++) pts.push({ t: t += DT, x: 0, y: 0 });
    for (let i = 0; i < 30; i++) pts.push({ t: t += DT, x: 90, y: 0 });
    let x = 90, v = 0;
    for (let i = 0; i < 40; i++) { const k = over ? 9000 : 2500, c = over ? 60 : 100; v += (-k * x - c * v) * 0.008; x += v * 0.008; pts.push({ t: t += DT, x: Math.round(x), y: 0 }); }
  }
  return pts;
}
function flicks(peak) {
  const pts = []; let t = 0;
  for (let n = 0; n < 8; n++) {
    for (let i = 0; i < 40; i++) pts.push({ t: t += DT, x: 0, y: 0 });
    for (let i = 1; i <= 6; i++) pts.push({ t: t += DT, x: peak * i / 6, y: 0 });
    for (let i = 0; i < 10; i++) pts.push({ t: t += DT, x: peak, y: 0 });
    for (let i = 5; i >= 0; i--) pts.push({ t: t += DT, x: peak * i / 6, y: 0 });
  }
  return pts;
}

test('rest: clean ok, offset bad', () => {
  assert.equal(analyzeRest(rest()).status, 'ok');
  assert.equal(analyzeRest(rest(400, 6, -1)).status, 'bad');
  assert.equal(analyzeRest([]).enough, false);
});
test('rotation: clean ok, skewed diagonal flagged, partial lap incomplete', () => {
  assert.equal(analyzeRotation(rotation()).status, 'ok');
  const r = analyzeRotation(rotation(7));
  assert.notEqual(r.sDiag, 'ok');
  const part = []; let t = 0;
  for (let a = 0; a < 200; a++) part.push({ t: t += 24, x: Math.cos(a * Math.PI / 180) * gateR(a), y: Math.sin(a * Math.PI / 180) * gateR(a) });
  const p = analyzeRotation(part);
  assert.ok(!p.enough || p.missing.length > 0);
});
test('releases: damped ok, underdamped flagged', () => {
  assert.equal(analyzeReleases(releases(false)).status, 'ok');
  const r = analyzeReleases(releases(true));
  assert.notEqual(r.status, 'ok');
  assert.ok(r.worstOpp > 20);
});
test('flicks: strong ok, weak bad', () => {
  assert.equal(analyzeFlicks(flicks(85)).status, 'ok');
  assert.equal(analyzeFlicks(flicks(50)).status, 'bad');
});
test('evalChecks: pass / fail / missing', () => {
  const res = runAnalyses('release', releases(true));
  const [c] = evalChecks([{ label: 'x', path: 'releases.worstOpp', op: '<=', value: 20 }], res);
  assert.equal(c.pass, false);
  const [m] = evalChecks([{ label: 'x', path: 'rotation.maxDiagErr', op: '<=', value: 3 }], res);
  assert.equal(m.missing, true);
  const ok = runAnalyses('release', releases(false));
  assert.equal(evalChecks([{ label: 'x', path: 'releases.worstOpp', op: '<=', value: 20 }], ok)[0].pass, true);
  const rot = runAnalyses('rotate', rotation());
  assert.equal(evalChecks([{ label: 'm', path: 'rotation.missing.length', op: '==', value: 0 }], rot)[0].pass, true);
});
test('metrics + diff: improvement is reported as better', () => {
  const before = metricsOf(runAnalyses('release', releases(true)));
  const after = metricsOf(runAnalyses('release', releases(false)));
  const d = diffMetrics(before, after).find(x => x.key === 'releases.worstOpp');
  assert.equal(d.better, true);
});
test('summarize and coach use the selected profile', () => {
  const res = runAnalyses('release', releases(true));
  assert.ok(summarize(res).releases);
  const adv = localCoach('accidental dashbacks', res, fw031);
  assert.ok(adv.some(a => /Smart Snapback/.test(a.b)), 'advice should come from the profile');
  assert.ok(localCoach('drift', {}, fw031).some(a => /Rest/.test(a.t)));
});
