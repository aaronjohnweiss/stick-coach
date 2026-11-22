import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCombo, GuideTracker, matchFirmware } from '../src/core/guide.js';
import { Runner, stepAuto } from '../src/core/walkthrough.js';
import { BUNDLED, validateProfile } from '../src/data/firmware/index.js';
import { runAnalyses } from '../src/core/analysis.js';

test('parseCombo splits keys and keeps named tokens', () => {
  assert.deepEqual(parseCombo('AXY + Start'), [['A', 'X', 'Y'], ['Start']]);
  assert.deepEqual(parseCombo('A + X/Y + Du/Dd'), [['A'], ['X/Y'], ['Du/Dd']]);
  assert.deepEqual(parseCombo('Left D-Pad + Start'), [['Left D-Pad'], ['Start']]);
  assert.deepEqual(parseCombo('L + A + Z + Du/Dd'), [['L'], ['A'], ['Z'], ['Du/Dd']]);
});

test('bundled profiles validate and have unique ids', () => {
  const ids = new Set();
  for (const p of BUNDLED) {
    assert.deepEqual(validateProfile(p), [], `profile ${p.id}`);
    assert.ok(!ids.has(p.id)); ids.add(p.id);
  }
  assert.ok(BUNDLED.length >= 3);
});

test('validateProfile rejects malformed profiles', () => {
  assert.ok(validateProfile({}).length > 0);
  const bad = JSON.parse(JSON.stringify(BUNDLED[0]));
  bad.procedures[1].steps[0].kind = 'nope';
  assert.ok(validateProfile(bad).some(e => /unknown kind/.test(e)));
  const bad2 = JSON.parse(JSON.stringify(BUNDLED[0]));
  bad2.procedures[1].steps.find(s => s.kind === 'test').test.checks[0].op = '~';
  assert.ok(validateProfile(bad2).some(e => /malformed/.test(e)));
});

test('every test check path resolves against the analysis result shape', () => {
  const sample = { rest: { enough: true, offset: 0 }, rotation: { enough: true, maxDiagErr: 0, asym: 0, maxOff: 0, missing: [] }, releases: { enough: true, worstOpp: 0 }, flicks: { enough: true, frac: 1 } };
  for (const p of BUNDLED) for (const pr of p.procedures) for (const st of pr.steps) if (st.kind === 'test') {
    for (const c of st.test.checks) {
      const v = c.path.split('.').reduce((o, k) => o == null ? undefined : o[k], sample);
      assert.equal(typeof v, 'number', `${p.id}/${pr.id}/${st.id}: ${c.path}`);
    }
    assert.ok(Object.keys(runAnalyses(st.test.mode, [])).length >= 1);
  }
});

test('0.31 calibration contains the documented combos', () => {
  const p = BUNDLED.find(x => x.id === '0.31');
  const left = p.procedures.find(x => x.id === 'calibrate-left');
  const c = p.procedures.find(x => x.id === 'calibrate-c');
  assert.ok(left.steps.some(s => s.combo === 'AXY + L'));
  assert.ok(c.steps.some(s => s.combo === 'AXY + R'));
  assert.ok(left.steps.some(s => s.combo === 'AXY + Start'));
  assert.equal(left.steps.find(s => s.kind === 'guide').guideStick, 'c');
  assert.equal(c.steps.find(s => s.kind === 'guide').guideStick, 'left');
  const snap = p.procedures.find(x => x.id === 'snapback');
  assert.ok(snap.steps.some(s => s.combo === 'A + X/Y + Du/Dd'));
});

test('GuideTracker counts guide movements through center/notch alternation', () => {
  const g = new GuideTracker();
  let t = 0;
  const hold = (x, y, ms = 200) => { for (let i = 0; i < ms / 8; i++) g.feed(t += 8, x, y); };
  hold(0, 0); // initial state (center), not a press
  assert.equal(g.presses, 0);
  const notches = [[100, 0], [70, 70], [0, 100], [-70, 70], [-100, 0], [-70, -70], [0, -100], [70, -70]];
  for (const [x, y] of notches) { hold(x, y); hold(0, 0); }
  assert.equal(g.presses, 16);
  assert.equal(g.phase, 'measure');
  assert.match(g.prompt(), /center|release/i);
  for (let i = 0; i < 8; i++) { hold(100, 0); hold(0, 0); }
  assert.equal(g.presses, 32);
  assert.equal(g.phase, 'adjust');
});

test('GuideTracker ignores brief transits and names notches', () => {
  const g = new GuideTracker();
  let t = 0;
  for (let i = 0; i < 30; i++) g.feed(t += 8, 0, 0);
  for (let i = 0; i < 5; i++) g.feed(t += 8, 100, 0); // 40 ms: too short
  for (let i = 0; i < 30; i++) g.feed(t += 8, 0, 0);
  assert.equal(g.presses, 0);
  for (let i = 0; i < 30; i++) g.feed(t += 8, 0, 100);
  assert.equal(g.stable, 'Up');
  assert.match(g.prompt(), /Up notch/);
});

test('GuideTracker counts a missed first press when the first observed position is a notch', () => {
  const g = new GuideTracker();
  let t = 0;
  for (let i = 0; i < 30; i++) g.feed(t += 8, 100, 0);
  assert.equal(g.presses, 1);
  for (let i = 0; i < 30; i++) g.feed(t += 8, 0, 0);
  assert.equal(g.presses, 2);
});

test('matchFirmware maps readings to profiles', () => {
  assert.equal(matchFirmware(BUNDLED, 31).profile.id, '0.31');
  assert.equal(matchFirmware(BUNDLED, 29).profile.id, '0.29');
  assert.equal(matchFirmware(BUNDLED, 25).profile.id, '0.25');
  assert.equal(matchFirmware(BUNDLED, 32).confidence, 'near');
  assert.equal(matchFirmware(BUNDLED, 0).profile, null);
  assert.equal(matchFirmware(BUNDLED, 0).confidence, 'none');
  assert.equal(matchFirmware(BUNDLED, 77).profile, null);
});

test('Runner navigates, evaluates checks and gates steps', () => {
  const p = BUNDLED[0];
  const r = new Runner(p, p.procedures.find(x => x.id === 'snapback'));
  assert.equal(r.idx, 0);
  while (r.step.kind !== 'test') r.next();
  const bad = r.evaluate({ releases: { enough: true, worstOpp: 35 } });
  assert.equal(bad.pass, false);
  assert.equal(stepAuto(r.step, { testPass: false }).ready, false);
  const good = r.evaluate({ releases: { enough: true, worstOpp: 12 } });
  assert.equal(good.pass, true);
  assert.equal(stepAuto(r.step, { testPass: true }).ready, true);
  assert.equal(stepAuto({ kind: 'manual' }, {}).ready, true);
  assert.equal(stepAuto({ kind: 'rest' }, { restMs: 100 }).ready, false);
  assert.equal(stepAuto({ kind: 'rest' }, { restMs: 900 }).ready, true);
  assert.equal(stepAuto({ kind: 'guide' }, { guide: { presses: 10, total: 32, phase: 'measure' } }).ready, false);
  while (r.next()) { /* run to the end */ }
  assert.equal(r.finished, true);
  r.prev();
  assert.equal(r.finished, false);
});
