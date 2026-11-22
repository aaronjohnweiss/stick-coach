// Input sources: GameCube adapter (Tauri/Rust USB, or WebUSB in a browser), browser gamepad, and a mouse-driven demo.
// Every source emits samples as offsets from center: {x, y, cx, cy, l, r} (y is up).
export const GC_VID = 0x057e, GC_PID = 0x0337;

export function parseAdapter(dv) {
  if (dv.byteLength < 37 || dv.getUint8(0) !== 0x21) return null;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const o = 1 + 9 * i;
    out.push({
      connected: (dv.getUint8(o) >> 4) !== 0,
      b1: dv.getUint8(o + 1), b2: dv.getUint8(o + 2),
      lx: dv.getUint8(o + 3), ly: dv.getUint8(o + 4), cx: dv.getUint8(o + 5), cy: dv.getUint8(o + 6),
      l: dv.getUint8(o + 7), r: dv.getUint8(o + 8)
    });
  }
  return out;
}

// Adapters report a neutral stick as 127 or 128 (GTS shows the origin as -1 or 0 and measures from it), so offsets
// are taken from each port's origin: its first reading after the port connects, if that looks like a neutral stick.
// Anything else (a stick already being held) falls back to 128.
const originOf = raw => (raw === 127 || raw === 128 ? raw : 128);

// Turns a 4-port packet into handler calls; shared by the Tauri and WebUSB paths.
export function makeFeeder(h) {
  let tick = 0;
  const origins = [null, null, null, null];
  return ports => {
    if ((tick++ % 60) === 0) h.onPorts(ports);
    ports.forEach((q, i) => {
      if (!q.connected) origins[i] = null;
      else if (!origins[i]) origins[i] = { lx: originOf(q.lx), ly: originOf(q.ly), cx: originOf(q.cx), cy: originOf(q.cy) };
    });
    const i = h.getPort(), p = ports[i], o = origins[i];
    if (p && p.connected) h.onSample({ x: p.lx - o.lx, y: p.ly - o.ly, cx: p.cx - o.cx, cy: p.cy - o.cy, l: p.l, r: p.r, b1: p.b1, b2: p.b2 });
  };
}

// Desktop app: the Rust side reads the adapter over USB and emits 'adapter-sample' events (array of 4 raw ports).
async function connectAdapterTauri(h, tauri) {
  const feed = makeFeeder(h);
  const src = { type: 'adapter', stopped: false, hasButtons: true, unlisten: [] };
  src.unlisten.push(await tauri.event.listen('adapter-sample', e => { if (!src.stopped) feed(e.payload); }));
  src.unlisten.push(await tauri.event.listen('adapter-error', e => { if (!src.stopped) h.onStatus('Adapter disconnected: ' + e.payload, 'bad'); }));
  src.stop = async () => {
    src.stopped = true;
    src.unlisten.forEach(u => u());
    try { await tauri.core.invoke('adapter_stop'); } catch (e) { /* already stopped */ }
  };
  try { await tauri.core.invoke('adapter_start'); }
  catch (e) { await src.stop(); throw new Error(typeof e === 'string' ? e : e.message); }
  return src;
}

// handlers: {onSample(s), onPorts(ports), onStatus(msg, level), getPort()}
export async function connectAdapter(h) {
  const tauri = globalThis.__TAURI__;
  if (tauri && tauri.core && tauri.event) return connectAdapterTauri(h, tauri);
  if (!navigator.usb) throw new Error('WebUSB is not available here. Use the desktop app or Chrome/Edge.');
  const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: GC_VID, productId: GC_PID }] });
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  await dev.claimInterface(0);
  const alt = dev.configuration.interfaces[0].alternates[0];
  const epIn = alt.endpoints.find(e => e.direction === 'in');
  const epOut = alt.endpoints.find(e => e.direction === 'out');
  if (!epIn || !epOut) throw new Error('Adapter endpoints not found');
  await dev.transferOut(epOut.endpointNumber, new Uint8Array([0x13]));
  const src = { type: 'adapter', stopped: false, hasButtons: true };
  src.stop = async () => { src.stopped = true; try { await dev.close(); } catch (e) { /* already closed */ } };
  const feed = makeFeeder(h);
  (async () => {
    while (!src.stopped) {
      try {
        const r = await dev.transferIn(epIn.endpointNumber, 37);
        if (r.status !== 'ok' || !r.data) continue;
        const ports = parseAdapter(r.data);
        if (ports) feed(ports);
      } catch (e) {
        if (!src.stopped) h.onStatus('Adapter disconnected: ' + e.message, 'bad');
        break;
      }
    }
  })();
  return src;
}

// Browser Gamepad API fallback (approximate values, ~60 Hz).
export function connectPad(h) {
  const src = { type: 'pad', stopped: false, hasButtons: false, stop: async () => { src.stopped = true; } };
  const loop = () => {
    if (src.stopped) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find(g => g && g.connected);
    if (gp) {
      const a = gp.axes;
      h.onSample({ x: Math.round((a[0] || 0) * 100), y: Math.round(-(a[1] || 0) * 100), cx: Math.round((a[2] || 0) * 100), cy: Math.round(-(a[3] || 0) * 100), l: 0, r: 0, b1: 0, b2: 0 });
    }
    requestAnimationFrame(loop);
  };
  loop();
  return src;
}

// Mouse/touch-driven fake stick at 125 Hz, optional underdamped "snapback".
export function connectDemo(h) {
  const d = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, down: false, snap: false, cx: 0, cy: 0, cdown: false };
  const src = { type: 'demo', stopped: false, hasButtons: true };
  let b1 = 0, b2 = 0;
  src.setButtons = (n1, n2) => { b1 = n1; b2 = n2; }; // raw adapter button bytes (keyboard-driven in the UI)
  src.pointer = (x, y, down) => { d.tx = x; d.ty = y; d.down = down; };
  src.pointerC = (x, y, down) => { d.cx = x; d.cy = y; d.cdown = down; }; // C-stick follows the pointer directly (used to fake a calibration guide)
  src.setSnap = v => { d.snap = !!v; };
  const timer = setInterval(() => {
    const dt = 0.008;
    if (d.down) { d.x += (d.tx - d.x) * 0.45; d.y += (d.ty - d.y) * 0.45; d.vx = d.vy = 0; }
    else {
      const k = d.snap ? 9000 : 2500, c = d.snap ? 60 : 2 * Math.sqrt(2500);
      d.vx += (-k * d.x - c * d.vx) * dt; d.vy += (-k * d.y - c * d.vy) * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
    const nz = () => (Math.random() - 0.5) * 0.6;
    const cx = d.cdown ? d.cx : 0, cy = d.cdown ? d.cy : 0;
    h.onSample({ x: Math.round(d.x + nz()), y: Math.round(d.y + nz()), cx: Math.round(cx + nz()), cy: Math.round(cy + nz()), l: 0, r: 0, b1, b2 });
  }, 8);
  src.stop = async () => { src.stopped = true; clearInterval(timer); };
  return src;
}
