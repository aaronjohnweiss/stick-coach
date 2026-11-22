import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeButtons, encodeButtons, comboHeld, comboRequirements, ButtonTracker } from '../src/core/buttons.js';
import { GuideTracker, VersionReader, matchFirmware } from '../src/core/guide.js';
import { BUNDLED } from '../src/data/firmware/index.js';

const KNOWN = new Set(['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'Du', 'Dd', 'Dl', 'Dr']);
const prof = id => BUNDLED.find(p => p.id === id);

test('decode/encode buttons round trip and combo matching', () => {
  const held = decodeButtons(0x01 | 0x80, 0x02);
  assert.deepEqual([...held].sort(), ['A', 'Du', 'Z']);
  assert.deepEqual(encodeButtons(held), [0x81, 0x02]);
  assert.equal(comboHeld(held, 'AZ + Du'), true);
  assert.equal(comboHeld(held, 'AXY + Start'), false);
  assert.equal(comboHeld(decodeButtons(0x01 | 0x40, 0x08), 'L + A + Du/Dd'), true); // Dd satisfies Du/Dd
  assert.equal(comboHeld(decodeButtons(0x04, 0x01), 'A + X/Y + Du/Dd'), false);
  assert.equal(comboHeld(decodeButtons(0x08, 0), 'L + A/B + Du/Dd'), false);
});

test('ButtonTracker reports rising and falling edges', () => {
  const b = new ButtonTracker();
  assert.deepEqual(b.update(new Set(['A'])), { down: ['A'], up: [] });
  assert.deepEqual(b.update(new Set(['A', 'L'])), { down: ['L'], up: [] });
  assert.deepEqual(b.update(new Set(['L'])), { down: [], up: ['A'] });
});

test('GuideTracker counts real presses (L/R/A), Z goes back, Start jumps only when allowed', () => {
  const g = new GuideTracker({ total: 4, startJumps: true });
  g.pressKeys(['L']); g.pressKeys(['A']); g.pressKeys(['B']); // B is not an advance key
  assert.equal(g.btnPresses, 2);
  g.pressKeys(['Z']);
  assert.equal(g.btnPresses, 1);
  assert.equal(g.usingButtons, true);
  assert.equal(g.phase, 'measure');
  g.pressKeys(['Start']);
  assert.equal(g.phase, 'adjust');
  const g2 = new GuideTracker({ total: 4, startJumps: false });
  g2.pressKeys(['R', 'Start']);
  assert.equal(g2.phase, 'measure');
  // 0.25 style: only L or R advance
  const g3 = new GuideTracker({ total: 16, advanceKeys: ['L', 'R'] });
  g3.pressKeys(['A', 'L', 'R']);
  assert.equal(g3.btnPresses, 2);
  assert.match(g3.advanceText(), /L or R/);
  // presses after the measurement phase are not counted
  const g4 = new GuideTracker({ total: 2 });
  g4.pressKeys(['A', 'A', 'A', 'A']);
  assert.equal(g4.btnPresses, 2);
});

test('GuideTracker flags disagreement between button presses and guide movements', () => {
  const g = new GuideTracker();
  g.pressKeys(Array(6).fill('A'));
  assert.equal(g.mismatch, true); // 6 presses, 0 guide movements
});

test('VersionReader accepts a C-stick Y value held steady for 500 ms', () => {
  const r = new VersionReader();
  let t = 0, res = null;
  for (let i = 0; i < 200; i++) assert.equal(r.feed(t += 8, 127, 127), null); // command freeze (up-right)
  for (let i = 0; i < 20; i++) assert.equal(r.feed(t += 8, 0, 0), null);
  for (let i = 0; i < 100 && !res; i++) res = r.feed(t += 8, 0, 29);
  assert.deepEqual(res, { value: 29, axis: 'y', responded: true });
  assert.ok(t >= 500 + 8 * 220 - 8 && t < 500 + 8 * 220 + 16); // fires at ~500 ms, not earlier
  assert.equal(matchFirmware(BUNDLED, res.value).profile.id, '0.29');
});

test('VersionReader ignores a drifting or briefly held stick in the 25-35 range', () => {
  const r = new VersionReader();
  let t = 0;
  for (let i = 0; i < 200; i++) assert.equal(r.feed(t += 8, 0, 25 + (i % 11)), null); // sweeping through the range
  for (let i = 0; i < 40; i++) assert.equal(r.feed(t += 8, 0, 30), null); // only 320 ms
  assert.equal(r.feed(t += 8, 0, 60), null); // leaves the range: the run resets
  for (let i = 0; i < 40; i++) assert.equal(r.feed(t += 8, 0, 30), null);
});

test('VersionReader also reads the X axis', () => {
  const r = new VersionReader({ holdMs: 100 });
  let t = 0, res = null;
  for (let i = 0; i < 30 && !res; i++) res = r.feed(t += 8, 31, 0);
  assert.deepEqual(res, { value: 31, axis: 'x', responded: true });
});

test('bundled versions: exactly 0.25-0.29 and 0.31 (0.30 never released), unique numbers', () => {
  assert.deepEqual(BUNDLED.map(p => p.id).sort(), ['0.25', '0.26', '0.27', '0.28', '0.29', '0.31']);
  const nums = BUNDLED.flatMap(p => p.versionNumbers);
  assert.equal(new Set(nums).size, nums.length);
  assert.ok(!BUNDLED.some(p => p.versionNumbers.includes(30)));
  for (const p of BUNDLED) assert.match(p.source.url, new RegExp(p.id === '0.31' ? 'Latest' : 'v' + p.id.replace('0.', '0\\.')));
});

test('version-specific differences match the guides', () => {
  const setting = (id, sid) => prof(id).settings.find(s => s.id === sid);
  assert.equal(setting('0.27', 'rumble').range, '0 to 7');
  assert.equal(setting('0.26', 'rumble').range, '0 to 7');
  assert.equal(setting('0.28', 'rumble').range, '0 to 11');
  assert.equal(setting('0.29', 'scaleL').range, '82 to 125');
  assert.equal(setting('0.31', 'scaleL').range, '90 to 110');
  assert.equal(setting('0.29', 'smart').range, '-10 to 10');
  assert.equal(setting('0.28', 'smart').range, '0 to 10');
  assert.ok(setting('0.28', 'offset'));
  assert.equal(setting('0.29', 'offset'), undefined); // removed in 0.29
  assert.ok(setting('0.26', 'waveL'));
  assert.equal(setting('0.25', 'waveL'), undefined); // waveshaping arrived in 0.26
  assert.equal(setting('0.28', 'scaleL'), undefined);
  assert.equal(setting('0.25', 'trigMode').combo, 'ZL + Start');
  assert.equal(setting('0.26', 'trigMode').combo, 'AB + L');
  assert.equal(setting('0.25', 'autoInit').combo, 'ABLR + Start');
  assert.equal(setting('0.28', 'autoInit').combo, 'AXYZ');
  assert.ok(setting('0.29', 'tourney'));
  assert.equal(setting('0.28', 'tourney'), undefined);
});

test('calibration step settings per version', () => {
  const measure = id => prof(id).procedures.find(p => p.id === 'calibrate-left').steps.find(s => s.kind === 'guide');
  for (const id of ['0.26', '0.27', '0.28', '0.29']) {
    assert.equal(measure(id).presses, 32); assert.deepEqual(measure(id).advanceKeys, ['L', 'R', 'A']); assert.equal(measure(id).startJumps, true);
  }
  assert.deepEqual(measure('0.25').advanceKeys, ['L', 'R']);
  assert.equal(measure('0.25').presses, 16);
  assert.equal(measure('0.25').unverified, true);
  assert.equal(measure('0.31').guideStick, 'c');
});

test('every combo in every profile is made of buttons the adapter can report', () => {
  for (const p of BUNDLED) {
    const combos = [...p.settings.map(s => s.combo), ...p.settings.map(s => s.display).filter(d => d && /^[A-Z+ /a-z]+$/.test(d) && /Start/.test(d)),
      ...p.procedures.flatMap(pr => pr.steps.map(s => s.combo).filter(Boolean))];
    for (const c of combos) for (const alts of comboRequirements(c)) for (const k of alts) assert.ok(KNOWN.has(k), `${p.id}: "${c}" uses unknown key ${k}`);
  }
});
