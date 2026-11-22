import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRotation, runAnalyses } from '../src/core/analysis.js';
import { BUNDLED } from '../src/data/firmware/index.js';
import {
  createSnapshot, validateSnapshot, settingsSheet, compactBlock, snapshotMetrics, snapshotResults,
  parseStore, serializeStore, mergeImported
} from '../src/core/snapshots.js';
import { makeSnapshotStore } from '../src/core/snapshotstore.js';

// A gate trace: three laps around a rim of radius 80. With `skewDiag`, each diagonal notch sits 6 degrees off.
function gate(skewDiag = false) {
  const pts = []; let t = 0;
  for (let lap = 0; lap < 3; lap++) {
    for (let a = 0; a < 360; a += 1) {
      const k = Math.round(a / 45) % 8;
      const bump = skewDiag && k % 2 === 1 ? 5 * Math.max(0, 1 - Math.abs(a - (k * 45 + 6)) / 4) : 0;
      const r = 80 + bump;
      pts.push({ t: (t += 8), x: r * Math.cos(a * Math.PI / 180), y: r * Math.sin(a * Math.PI / 180) });
    }
  }
  return pts;
}

test('N/A notches are excluded from rotation statistics and from "missing"', () => {
  const pts = gate();
  const full = analyzeRotation(pts);
  assert.equal(full.enough, true);
  // Remove all data near the up-right diagonal (k=1): it counts as missing unless marked N/A.
  const holed = pts.filter(p => { const a = ((Math.atan2(p.y, p.x) * 180 / Math.PI) + 360) % 360; return Math.abs(a - 45) > 14; });
  const withMissing = analyzeRotation(holed);
  assert.deepEqual(withMissing.missing, ['Up-right']);
  assert.equal(withMissing.sMiss, 'warn');
  const masked = analyzeRotation(holed, [1]);
  assert.deepEqual(masked.missing, []);
  assert.equal(masked.sMiss, 'ok');
  // a bad diagonal that is marked N/A no longer drives the diagonal error
  const skew = analyzeRotation(gate(true));
  assert.ok(skew.maxDiagErr > 1);
  const noDiag = analyzeRotation(gate(true), [1, 3, 5, 7]);
  assert.equal(noDiag.maxDiagErr, 0);
});

test('createSnapshot normalises fields and validateSnapshot checks them', () => {
  const s = createSnapshot({ name: '  ', rating: 9, stick: 'x', naNotches: [3, 3, 1, 99, 'a'], settings: [{ id: 'scaleL', name: 'Scaling', value: 100 }] });
  assert.equal(s.name, 'Untitled snapshot');
  assert.equal(s.rating, 5);
  assert.equal(s.stick, 'left');
  assert.deepEqual(s.naNotches, [1, 3]);
  assert.equal(s.settings[0].value, '100');
  assert.deepEqual(validateSnapshot(s), []);
  assert.ok(validateSnapshot({ ...s, rating: 7 }).length);
  assert.ok(validateSnapshot({ ...s, naNotches: [8] }).length);
});

test('settingsSheet prefills numeric settings with the profile defaults', () => {
  const sheet = settingsSheet(BUNDLED.find(p => p.id === '0.31'));
  const scale = sheet.find(s => s.id === 'scaleL');
  assert.deepEqual([scale.range, scale.value], ['90 to 110', '100']);
  assert.ok(sheet.every(s => s.range && s.combo));
  assert.ok(!sheet.some(s => s.id === 'configure')); // toggles without a range are not settings
});

test('measurements are compacted and metrics honour the snapshot N/A mask', () => {
  const rot = runAnalyses('rotate', gate(true));
  const rest = runAnalyses('rest', Array.from({ length: 400 }, (_, i) => ({ t: i * 8, x: 0.4, y: -0.3 })));
  const measurements = { rotation: compactBlock('rotate', rot), rest: compactBlock('rest', rest) };
  assert.equal(compactBlock('flick', {}), null);
  assert.equal(measurements.rotation.notches.length, 8);
  assert.ok(!('events' in measurements.rest));
  const snap = createSnapshot({ name: 'a', measurements });
  const masked = createSnapshot({ name: 'b', measurements, naNotches: [1, 3, 5, 7] });
  const m1 = snapshotMetrics(snap), m2 = snapshotMetrics(masked);
  assert.ok(m1['rotation.maxDiagErr'] > 1);
  assert.equal(m2['rotation.maxDiagErr'], 0);
  assert.ok(snapshotResults(snap).rest.enough);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap); // stays plain JSON
});

test('store file round-trips, skips bad entries and merges imports without duplicating', () => {
  const a = createSnapshot({ name: 'a', id: 'A', createdAt: 1 }), b = createSnapshot({ name: 'b', id: 'B', createdAt: 2 });
  const text = serializeStore([a, b]);
  assert.deepEqual(parseStore(text), { snapshots: [a, b], errors: [] });
  const dirty = JSON.stringify({ version: 1, snapshots: [a, { id: 'x' }] });
  const p = parseStore(dirty);
  assert.equal(p.snapshots.length, 1);
  assert.match(p.errors[0], /Skipped snapshot #2/);
  assert.match(parseStore('{oops').errors[0], /not valid JSON/);
  assert.deepEqual(parseStore(null), { snapshots: [], errors: [] });
  const same = mergeImported([a], serializeStore([a, b]));
  assert.deepEqual([same.added, same.skipped, same.list.length], [1, 1, 2]);
  const changed = mergeImported([a], serializeStore([{ ...a, name: 'edited' }]));
  assert.equal(changed.list.length, 2);
  assert.notEqual(changed.list[0].id, 'A'); // clashing id is re-issued, original kept
});

test('snapshot store uses the Rust commands in the desktop app and localStorage in a browser', async () => {
  const calls = [];
  const file = makeSnapshotStore({ tauri: { core: { invoke: async (c, a) => { calls.push([c, a]); return c === 'snapshots_load' ? serializeStore([createSnapshot({ name: 'x', id: 'X' })]) : undefined; } } } });
  assert.equal(file.kind, 'file');
  assert.equal((await file.load()).snapshots[0].id, 'X');
  await file.save([]);
  assert.equal(calls[1][0], 'snapshots_save');
  assert.equal(JSON.parse(calls[1][1].data).version, 1);
  const mem = {};
  const web = makeSnapshotStore({ local: { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } } });
  assert.equal(web.kind, 'browser');
  assert.deepEqual((await web.load()).snapshots, []);
  await web.save([createSnapshot({ name: 'y', id: 'Y' })]);
  assert.equal((await web.load()).snapshots[0].id, 'Y');
});
