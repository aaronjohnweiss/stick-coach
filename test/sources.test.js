import test from 'node:test';
import assert from 'node:assert/strict';
import { connectAdapter, parseAdapter } from '../src/core/sources.js';

const port = (o = {}) => ({ connected: false, b1: 0, b2: 0, lx: 128, ly: 128, cx: 128, cy: 128, l: 0, r: 0, ...o });

test('parseAdapter reads four ports from a raw packet', () => {
  const b = new Uint8Array(37); b[0] = 0x21; b[1] = 0x10; b[4] = 200; b[5] = 100;
  const p = parseAdapter(new DataView(b.buffer));
  assert.equal(p.length, 4);
  assert.equal(p[0].connected, true); assert.equal(p[0].lx, 200); assert.equal(p[1].connected, false);
  assert.equal(parseAdapter(new DataView(new Uint8Array(10).buffer)), null);
});

test('connectAdapter uses the Tauri bridge when present', async () => {
  const listeners = {}, calls = [];
  globalThis.__TAURI__ = {
    core: { invoke: async cmd => { calls.push(cmd); } },
    event: { listen: async (name, fn) => { listeners[name] = fn; return () => { delete listeners[name]; }; } }
  };
  try {
    const samples = [], statuses = [], ports = [];
    const src = await connectAdapter({ onSample: s => samples.push(s), onPorts: p => ports.push(p), onStatus: (m, l) => statuses.push([m, l]), getPort: () => 1 });
    assert.deepEqual(calls, ['adapter_start']);
    listeners['adapter-sample']({ payload: [port(), port({ connected: true, lx: 138, ly: 118, cx: 128, cy: 160, b1: 4 }), port(), port()] });
    assert.equal(ports.length, 1);
    assert.deepEqual(samples[0], { x: 10, y: -10, cx: 0, cy: 32, l: 0, r: 0, b1: 4, b2: 0 });
    listeners['adapter-sample']({ payload: [port(), port(), port(), port()] }); // selected port disconnected
    assert.equal(samples.length, 1);
    listeners['adapter-error']({ payload: 'unplugged' });
    assert.match(statuses[0][0], /unplugged/);
    await src.stop();
    assert.deepEqual(calls, ['adapter_start', 'adapter_stop']);
    assert.deepEqual(Object.keys(listeners), []);
  } finally { delete globalThis.__TAURI__; }
});

test('stick offsets are measured from each port\'s origin (127 on OEM/Mayflash adapters)', async () => {
  const { makeFeeder } = await import('../src/core/sources.js');
  const out = [];
  const feed = makeFeeder({ onPorts() { }, onSample: s => out.push(s), getPort: () => 0 });
  feed([port({ connected: true, lx: 127, ly: 127, cx: 127, cy: 127 }), port(), port(), port()]); // neutral: origin 127
  feed([port({ connected: true, lx: 127, ly: 127, cx: 127, cy: 156 }), port(), port(), port()]); // version 29 on C-stick Y
  assert.deepEqual([out[0].x, out[0].cy, out[1].cy, out[1].x], [0, 0, 29, 0]);
  // origin 128 adapters are unchanged, and a stick already held at connect falls back to 128
  out.length = 0;
  const feed2 = makeFeeder({ onPorts() { }, onSample: s => out.push(s), getPort: () => 0 });
  feed2([port({ connected: true, lx: 128, ly: 140, cx: 128, cy: 128 }), port(), port(), port()]);
  feed2([port({ connected: true, lx: 128, ly: 140, cx: 128, cy: 157 }), port(), port(), port()]);
  assert.deepEqual([out[0].y, out[1].cy], [12, 29]);
  // reconnecting a port re-reads its origin
  out.length = 0;
  const feed3 = makeFeeder({ onPorts() { }, onSample: s => out.push(s), getPort: () => 0 });
  feed3([port({ connected: true, lx: 128, ly: 128, cx: 128, cy: 128 }), port(), port(), port()]);
  feed3([port(), port(), port(), port()]);
  feed3([port({ connected: true, lx: 127, ly: 127, cx: 127, cy: 127 }), port(), port(), port()]);
  assert.deepEqual([out[0].cx, out[1].cx], [0, 0]);
});

test('re-zero re-reads the origin from a resting stick, ignores a stick that is not at rest', async () => {
  const { makeFeeder } = await import('../src/core/sources.js');
  const out = [];
  const feed = makeFeeder({ onPorts() { }, onSample: s => out.push(s), getPort: () => 0 });
  const at = (lx, cy) => [port({ connected: true, lx, ly: 128, cx: 128, cy }), port(), port(), port()];
  feed(at(128, 128)); // origin 128
  feed(at(130, 128)); assert.equal(out.at(-1).x, 2);
  feed.rezero(); feed(at(130, 128)); assert.equal(out.at(-1).x, 0); // origin is now 130
  feed.rezero(); feed(at(200, 128)); assert.equal(out.at(-1).x, 70); // held far off-centre: origin stays 130
});

test('adapter reader restarts by itself after an unplug and stops cleanly', async () => {
  const listeners = {}, calls = [];
  let fail = true;
  globalThis.__TAURI__ = {
    core: { invoke: async cmd => { calls.push(cmd); if (cmd === 'adapter_start' && calls.length > 1 && fail) throw 'not found'; } },
    event: { listen: async (name, fn) => { listeners[name] = fn; return () => { delete listeners[name]; }; } }
  };
  try {
    const statuses = [];
    const src = await connectAdapter({ onSample() { }, onPorts() { }, onStatus: (m, l) => statuses.push([m, l]), getPort: () => 0 });
    listeners['adapter-error']({ payload: 'No such device' });
    assert.match(statuses[0][0], /Waiting for it to come back/);
    await new Promise(r => setTimeout(r, 3200)); // two failed retries (1.5 s apart)
    assert.ok(calls.filter(c => c === 'adapter_start').length >= 3);
    fail = false;
    await new Promise(r => setTimeout(r, 1700));
    assert.match(statuses.at(-1)[0], /reconnected/);
    const n = calls.length;
    await src.stop();
    await new Promise(r => setTimeout(r, 1700));
    assert.deepEqual(calls.slice(n), ['adapter_stop']); // no further restarts after stop
  } finally { delete globalThis.__TAURI__; }
});

test('connectAdapter surfaces a Rust start error and cleans up', async () => {
  globalThis.__TAURI__ = {
    core: { invoke: async cmd => { if (cmd === 'adapter_start') throw 'adapter not found'; } },
    event: { listen: async () => () => { } }
  };
  try { await assert.rejects(connectAdapter({ getPort: () => 0 }), /adapter not found/); }
  finally { delete globalThis.__TAURI__; }
});
