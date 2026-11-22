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

test('connectAdapter surfaces a Rust start error and cleans up', async () => {
  globalThis.__TAURI__ = {
    core: { invoke: async cmd => { if (cmd === 'adapter_start') throw 'adapter not found'; } },
    event: { listen: async () => () => { } }
  };
  try { await assert.rejects(connectAdapter({ getPort: () => 0 }), /adapter not found/); }
  finally { delete globalThis.__TAURI__; }
});
