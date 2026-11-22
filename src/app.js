import { CFG, DIRS, METRICS, hyp, angleOf, rnd, runAnalyses, summarize, metricsOf, diffMetrics } from './core/analysis.js';
import { parseCombo, GuideTracker, VersionReader, matchFirmware } from './core/guide.js';
import { decodeButtons, encodeButtons, comboHeld, keyAlts, ButtonTracker } from './core/buttons.js';
import { localCoach } from './core/coach.js';
import { Runner, stepAuto } from './core/walkthrough.js';
import { connectAdapter, connectPad, connectDemo } from './core/sources.js';
import { BUNDLED, validateProfile } from './data/firmware/index.js';
import { createSnapshot, validateSnapshot, settingsSheet, compactBlock, snapshotMetrics, snapshotResults, serializeStore, mergeImported, stars, BLOCK_OF } from './core/snapshots.js';
import { makeSnapshotStore } from './core/snapshotstore.js';
import { RELEASES_URL, updaterAvailable, checkForUpdate, installUpdate } from './core/updater.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

/* ================= state ================= */
const S = {
  source: null, latest: { x: 0, y: 0, cx: 0, cy: 0, l: 0, r: 0 }, trailL: [], trailC: [], rec: null, stopRec: null,
  last: null, page: 'live', profiles: [], fw: null, runner: null, tracker: new GuideTracker(), restSince: null,
  versionMatch: null, testPass: null, testBusy: false, guideStick: null,
  btn: new ButtonTracker(), held: new Set(), detect: null
};

const TESTS = {
  rest: { name: 'Rest (hands off)', dur: 3, text: "Let go of the stick completely and don't touch it for 3 seconds." },
  rotate: { name: 'Rotate the gate', dur: 14, text: 'Slowly trace the outer gate all the way around, pressing firmly into each notch. Do at least two laps (try both directions).' },
  release: { name: 'Release (snapback)', dur: 15, text: 'Push the stick to the rim in one direction, then let go quickly. Repeat about 5 times per direction you care about.' },
  flick: { name: 'Flick to rim', dur: 15, text: 'From neutral, flick quickly to the rim in one direction like a smash input, return to neutral, repeat 8-10 times.' },
  free: { name: 'Free record', dur: 20, text: 'Do whatever you need to demonstrate your issue. Press Stop when finished. All analyses run on the recording.' }
};

/* ================= profiles ================= */
function loadProfiles() {
  const custom = store.get('customProfiles', []).filter(p => validateProfile(p).length === 0);
  const ids = new Set(custom.map(p => p.id));
  S.profiles = [...BUNDLED.filter(p => !ids.has(p.id)), ...custom];
  const saved = store.get('fw', null);
  S.fw = S.profiles.find(p => p.id === saved) || S.profiles[0];
}
function renderFwSelect() {
  const sel = $('#fwSel'); sel.textContent = '';
  for (const p of S.profiles) sel.append(h('option', { value: p.id, text: p.label }));
  sel.value = S.fw.id;
  const b = $('#fwBadge'); b.textContent = '';
  const conf = { official: ['ok', 'Official guide'], derived: ['warn', 'Derived: confirm against your guide'], partial: ['warn', 'Partial: confirm against your guide'], custom: ['acc', 'Custom profile'] }[S.fw.confidence] || ['off', S.fw.confidence];
  b.append(h('span', { class: 'chip ' + conf[0], text: conf[1] }), ' ', h('a', { href: S.fw.source.url, target: '_blank', rel: 'noopener', text: S.fw.source.label }));
}
function setFirmware(id) {
  const p = S.profiles.find(x => x.id === id);
  if (!p) return;
  S.fw = p; store.set('fw', id);
  renderFwSelect(); renderProcList(); renderRef(); S.runner = null; renderRunner();
}
$('#fwSel').addEventListener('change', e => setFirmware(e.target.value));
$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    const errs = validateProfile(p);
    if (errs.length) { setStatus('Profile rejected: ' + errs.slice(0, 3).join('; '), 'bad'); return; }
    const custom = store.get('customProfiles', []).filter(x => x.id !== p.id); custom.push(p);
    store.set('customProfiles', custom); loadProfiles(); setFirmware(p.id);
    setStatus(`Imported profile "${p.label}".`, 'ok');
  } catch (err) { setStatus('Could not read profile: ' + err.message, 'bad'); }
});
$('#btnExportFw').addEventListener('click', () => download(`firmware-${S.fw.id}.json`, JSON.stringify(S.fw, null, 2), 'application/json'));

/* ================= sources ================= */
function setStatus(msg, level) { const el = $('#status'); el.textContent = msg; el.className = level ? 'chip ' + level : 'mut'; }
function renderPortChips(ports) {
  const box = $('#portChips'); box.textContent = '';
  ports.forEach((p, i) => box.append(h('span', { class: 'chip ' + (p.connected ? 'ok' : 'off'), style: 'margin-right:4px', text: 'P' + (i + 1) + (p.connected ? ' ●' : ' –') })));
}
function pushSample(s) {
  const t = performance.now();
  Object.assign(S.latest, s);
  const held = s.b1 !== undefined ? decodeButtons(s.b1, s.b2) : new Set();
  const { down } = S.btn.update(held); S.held = held;
  S.trailL.push({ t, x: s.x, y: s.y }); S.trailC.push({ t, x: s.cx, y: s.cy });
  while (S.trailL.length && t - S.trailL[0].t > 400) S.trailL.shift();
  while (S.trailC.length && t - S.trailC[0].t > 400) S.trailC.shift();
  if (S.rec) S.rec.samples.push({ t, x: s.x, y: s.y, cx: s.cx, cy: s.cy });
  // rest detection (both sticks centered and still)
  if (hyp(s.x, s.y) < 5 && hyp(s.cx, s.cy) < 5) { if (S.restSince === null) S.restSince = t; } else S.restSince = null;
  // guide tracking during calibration steps
  if (S.guideStick) { const g = S.guideStick === 'c' ? [s.cx, s.cy] : [s.x, s.y]; S.tracker.feed(t, g[0], g[1]); if (down.length) S.tracker.pressKeys(down); }
  feedDetect(t, s);
}
const handlers = {
  onSample: pushSample,
  onPorts: renderPortChips,
  onStatus: (m, l) => setStatus(m, l),
  getPort: () => +$('#port').value
};
async function disconnect() {
  const src = S.source; S.source = null;
  $('#demoOpts').hidden = true;
  if (src) await src.stop();
  $('#btnDisc').disabled = true; $('#btnRezero').disabled = true; $('#portChips').textContent = '';
  setStatus('Not connected. See the Help tab for adapter driver setup.');
}
function connected(src, msg, lvl) { S.source = src; $('#btnDisc').disabled = false; $('#btnRezero').disabled = !src.rezero; setStatus(msg, lvl); }
async function doConnectAdapter() {
  await disconnect();
  try { connected(await connectAdapter(handlers), 'Adapter connected. Move a stick.', 'ok'); }
  catch (e) { setStatus('Adapter error: ' + e.message + ' (see Help: driver / permissions).', 'bad'); }
}
async function doConnectDemo() {
  await disconnect();
  const src = connectDemo(handlers);
  $('#demoOpts').hidden = false;
  connected(src, 'Demo mode: drag in the control-stick box (C-stick box in Guided Setup). Keys: A B X Y Z L R, S = Start, arrow keys = D-pad.', 'warn');
}
$('#btnAdapter').addEventListener('click', doConnectAdapter);
$('#btnPad').addEventListener('click', async () => { await disconnect(); connected(connectPad(handlers), 'Browser gamepad mode: approximate values at ~60 Hz, no button reading. Press a button if nothing shows.', 'warn'); });
$('#btnDemo').addEventListener('click', doConnectDemo);
$('#btnDisc').addEventListener('click', disconnect);
$('#btnRezero').addEventListener('click', () => { if (S.source && S.source.rezero) { S.source.rezero(); setStatus('Origin re-read from the current stick position (leave both sticks at rest).', 'ok'); } });
$('#simSnap').addEventListener('change', e => { if (S.source && S.source.setSnap) S.source.setSnap(e.target.checked); });

function bindPointer(cvId, isC) {
  const cv = $(cvId), R = 115;
  const toRaw = ev => {
    const b = cv.getBoundingClientRect();
    const k = (cv.width / 2 - 14) / R;
    let x = ((ev.clientX - b.left) / b.width * cv.width - cv.width / 2) / k;
    let y = -((ev.clientY - b.top) / b.height * cv.height - cv.height / 2) / k;
    const r = hyp(x, y); if (r > 100) { x *= 100 / r; y *= 100 / r; }
    return [x, y];
  };
  let down = false;
  const send = (ev, d) => { const src = S.source; if (!src || src.type !== 'demo') return; const [x, y] = toRaw(ev); (isC ? src.pointerC : src.pointer)(x, y, d); };
  cv.addEventListener('pointerdown', ev => { if (!S.source || S.source.type !== 'demo') return; cv.setPointerCapture(ev.pointerId); down = true; send(ev, true); });
  cv.addEventListener('pointermove', ev => { if (down) send(ev, true); });
  const up = ev => { if (!down) return; down = false; send(ev, false); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
bindPointer('#cvL', false); bindPointer('#cvC', true); bindPointer('#cvGL', false); bindPointer('#cvGC', true);

// Demo mode: keyboard stands in for the controller buttons.
const KEYMAP = { a: 'A', b: 'B', x: 'X', y: 'Y', z: 'Z', l: 'L', r: 'R', s: 'Start', arrowup: 'Du', arrowdown: 'Dd', arrowleft: 'Dl', arrowright: 'Dr' };
const demoHeld = new Set();
function demoKey(e, on) {
  if (!S.source || S.source.type !== 'demo') return;
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const k = KEYMAP[String(e.key).toLowerCase()];
  if (!k) return;
  if (on) demoHeld.add(k); else demoHeld.delete(k);
  S.source.setButtons(...encodeButtons(demoHeld));
}
document.addEventListener('keydown', e => demoKey(e, true));
document.addEventListener('keyup', e => demoKey(e, false));

/* ================= drawing ================= */
function stickBase(cv) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, R = 115, k = (W / 2 - 14) / R, cx = W / 2, cy = H / 2;
  c.clearRect(0, 0, W, H); c.fillStyle = '#10131a'; c.fillRect(0, 0, W, H); c.lineWidth = 1;
  [[CFG.dz, '#3a4150'], [CFG.smash, '#3a4150'], [CFG.full, '#4a5368'], [100, '#2a2f3a']].forEach(([r, col]) => {
    c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#5b6578'; c.font = '10px sans-serif'; c.fillText(String(r), cx + r * k * 0.707 + 3, cy - r * k * 0.707 - 2);
  });
  c.strokeStyle = '#242a35';
  for (let a = 0; a < 8; a++) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a * Math.PI / 4) * 105 * k, cy - Math.sin(a * Math.PI / 4) * 105 * k); c.stroke(); }
  return { c, k, cx, cy };
}
function drawStick(cv, x, y, trail, color) {
  const { c, k, cx, cy } = stickBase(cv);
  const now = performance.now();
  for (const p of trail) {
    c.fillStyle = `rgba(110,168,254,${Math.max(0, 0.5 * (1 - (now - p.t) / 400))})`;
    c.beginPath(); c.arc(cx + p.x * k, cy - p.y * k, 3, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = color || '#ffd36e'; c.beginPath(); c.arc(cx + x * k, cy - y * k, 6, 0, Math.PI * 2); c.fill();
}
function drawRecording(cv, pts, results) {
  const { c, k, cx, cy } = stickBase(cv);
  if (!pts.length) return;
  const t0 = pts[0].t, tN = pts[pts.length - 1].t || 1;
  for (const p of pts) {
    const f = (p.t - t0) / Math.max(1, tN - t0);
    c.fillStyle = `hsla(${210 - 170 * f},85%,62%,0.55)`;
    c.fillRect(cx + p.x * k - 1.5, cy - p.y * k - 1.5, 3, 3);
  }
  const rot = results && results.rotation;
  if (rot && rot.enough) {
    c.strokeStyle = '#4cc38a'; c.fillStyle = '#4cc38a'; c.font = '11px sans-serif';
    for (const n of rot.notches) {
      if (n.missing) continue;
      c.beginPath(); c.arc(cx + n.x * k, cy - n.y * k, 6, 0, Math.PI * 2); c.stroke();
      c.fillText(`${rnd(n.x, 0)},${rnd(n.y, 0)}`, cx + n.x * k + 8, cy - n.y * k - 6);
    }
  }
}
function readout(el, x, y) { el.textContent = `x ${x}   y ${y}   r ${rnd(hyp(x, y))}   ∠ ${rnd(angleOf(x, y), 0)}°`; }

function frame() {
  const L = S.latest;
  updateFirstRun();
  if (S.page === 'live') {
    drawStick($('#cvL'), L.x, L.y, S.trailL); drawStick($('#cvC'), L.cx, L.cy, S.trailC);
    readout($('#roL'), L.x, L.y); readout($('#roC'), L.cx, L.cy);
  } else if (S.page === 'guide') {
    const gl = S.guideStick === 'left' ? '#6ee7a8' : undefined, gc = S.guideStick === 'c' ? '#6ee7a8' : undefined;
    drawStick($('#cvGL'), L.x, L.y, S.trailL, gl); drawStick($('#cvGC'), L.cx, L.cy, S.trailC, gc);
    readout($('#roGL'), L.x, L.y); readout($('#roGC'), L.cx, L.cy);
    updateGuideLive();
  }
  requestAnimationFrame(frame);
}

/* ================= recording ================= */
function recordTest(mode, which, onTick) {
  return new Promise((resolve, reject) => {
    if (!S.source) { reject(new Error('Connect a source first (adapter, gamepad or demo).')); return; }
    if (S.rec) { reject(new Error('A recording is already running.')); return; }
    const dur = TESTS[mode].dur, keys = which === 'c' ? ['cx', 'cy'] : ['x', 'y'];
    const rec = { start: performance.now(), samples: [] };
    S.rec = rec;
    let timer = null;
    const finish = () => {
      clearInterval(timer); S.rec = null; S.stopRec = null;
      const pts = rec.samples.map(s => ({ t: s.t, x: s[keys[0]], y: s[keys[1]] }));
      resolve({ mode, which, pts, results: runAnalyses(mode, pts) });
    };
    S.stopRec = finish;
    timer = setInterval(() => {
      const left = dur - (performance.now() - rec.start) / 1000;
      if (onTick) onTick(Math.max(0, left));
      if (left <= 0) finish();
    }, 100);
    if (onTick) onTick(dur);
  });
}

/* history */
function saveHistory(r, origin) {
  const hist = store.get('history', []);
  const metrics = metricsOf(r.results);
  const prev = hist.find(e => e.test === r.mode && e.stick === r.which);
  hist.unshift({ ts: Date.now(), test: r.mode, stick: r.which, fw: S.fw.id, origin, metrics });
  store.set('history', hist.slice(0, 200));
  return prev ? diffMetrics(prev.metrics, metrics) : [];
}

/* ================= live page ================= */
for (const k in TESTS) $('#testSel').append(h('option', { value: k, text: TESTS[k].name }));
$('#testSel').addEventListener('change', () => { $('#testHelp').textContent = TESTS[$('#testSel').value].text; });
$('#testHelp').textContent = TESTS.rest.text;

$('#btnStart').addEventListener('click', async () => {
  const mode = $('#testSel').value, which = $('#which').value;
  $('#btnStart').disabled = true; $('#btnStop').disabled = false;
  try {
    const r = await recordTest(mode, which, l => { $('#cd').textContent = 'Recording ' + l.toFixed(1) + ' s'; });
    S.last = r;
    drawRecording($('#cvR'), r.pts, r.results);
    renderFindings(r.results, r.pts);
    saveHistory(r, 'live'); renderHistory();
    $('#btnJson').disabled = $('#btnCsv').disabled = !r.pts.length;
  } catch (e) { setStatus(e.message, 'bad'); }
  $('#btnStart').disabled = false; $('#btnStop').disabled = true; $('#cd').textContent = '';
});
$('#btnStop').addEventListener('click', () => { if (S.stopRec) S.stopRec(); });

function metric(parent, label, value, status, detail) {
  parent.append(h('div', { class: 'metric' },
    h('div', { class: 'l', text: label }),
    h('div', { style: 'text-align:right' }, h('span', { class: 'chip ' + (status || 'off'), text: value })),
    detail ? h('div', { class: 'd', text: detail }) : null));
}
function renderFindings(res, pts, box = $('#findings')) {
  box.textContent = ''; box.className = '';
  if (!pts.length) { box.textContent = 'No samples were recorded. Move a stick while recording (and check the selected port).'; box.className = 'mut'; return; }
  const dur = (pts[pts.length - 1].t - pts[0].t) / 1000, hz = pts.length / Math.max(0.001, dur);
  box.append(h('div', { class: 'mut small', text: `${pts.length} samples over ${rnd(dur)} s (~${Math.round(hz)} Hz).` + (hz < 90 ? ' Low sample rate: snapback results will be unreliable. Use the adapter.' : '') }));
  if (res.rest) {
    const r = res.rest;
    if (!r.enough) metric(box, 'Rest', 'not enough data', 'off', 'Record at least ~1 s of rest.');
    else {
      metric(box, 'Neutral offset', `${rnd(r.meanX)}, ${rnd(r.meanY)}`, r.offset > 5 ? 'bad' : r.offset > 2 ? 'warn' : 'ok', `Average resting position. |offset| ${rnd(r.offset)}.`);
      metric(box, 'Noise', `σ ${rnd(r.stdX, 2)} / ${rnd(r.stdY, 2)}`, (r.stdX > 1.5 || r.stdY > 1.5) ? 'warn' : 'ok', `Max excursion ${rnd(r.maxR)}.`);
    }
  }
  if (res.rotation) {
    const r = res.rotation;
    if (!r.enough) metric(box, 'Gate rotation', 'not enough data', 'off', 'Trace the full outer gate for a few seconds (max radius seen ' + rnd(r.maxR || 0) + ').');
    else {
      metric(box, 'Cardinal reach spread', rnd(r.asym), r.sAsym, 'Difference between the largest and smallest cardinal radius.');
      metric(box, 'Diagonal angle error', rnd(r.maxDiagErr) + '°', r.sDiag, 'Worst diagonal notch vs. a true 45° line.');
      metric(box, 'Cardinal off-axis', rnd(r.maxOff), r.sOff, 'Perpendicular component at cardinal notches.');
      if (r.missing.length) metric(box, 'Missing notches', r.missing.join(', '), 'warn', 'No data near these directions.');
      box.append(h('pre', { class: 'ai', style: 'font:12px ui-monospace,Menlo,monospace', text: r.notches.filter(n => !n.missing).map(n => `${n.name}: (${rnd(n.x, 0)}, ${rnd(n.y, 0)}) r ${rnd(n.r)} ∠err ${rnd(n.angErr)}°`).join('\n') }));
    }
  }
  if (res.releases) {
    const r = res.releases;
    if (!r.enough) metric(box, 'Release / snapback', 'not enough data', 'off', `Found ${r.events.length} fast releases. Need at least 2 (push to rim, let go quickly).`);
    else {
      metric(box, 'Worst overshoot', rnd(r.worstOpp), r.status, `Furthest opposite-side excursion within 120 ms after release (deadzone edge about ${CFG.dz}). Mean ${rnd(r.meanOpp)} over ${r.count} releases.`);
      metric(box, 'By direction', r.dirs.map(d => `${d.dir} ${rnd(d.worst)}`).join(' · '), 'off', 'Worst overshoot per release direction.');
    }
  }
  if (res.flicks) {
    const r = res.flicks;
    if (!r.enough) metric(box, 'Flicks', 'not enough data', 'off', `Found ${r.events.length} flicks. Need at least 3.`);
    else metric(box, 'Flicks reaching ' + CFG.smash, `${r.reached}/${r.count}`, r.status, `Reached within 150 ms of leaving the deadzone. Median peak ${rnd(r.medPeak)}.`);
  }
}

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
$('#btnJson').addEventListener('click', () => { const r = S.last; download('stick-recording.json', JSON.stringify({ test: r.mode, stick: r.which, firmwareProfile: S.fw.id, samples: r.pts.map(p => ({ t: rnd(p.t - r.pts[0].t, 1), x: p.x, y: p.y })), summary: summarize(r.results) }, null, 1), 'application/json'); });
$('#btnCsv').addEventListener('click', () => { const r = S.last; download('stick-recording.csv', 't_ms,x,y\n' + r.pts.map(p => `${rnd(p.t - r.pts[0].t, 1)},${p.x},${p.y}`).join('\n'), 'text/csv'); });

$('#btnCoach').addEventListener('click', () => {
  const box = $('#advice'); box.textContent = '';
  localCoach($('#problem').value, S.last ? S.last.results : {}, S.fw).forEach(a => box.append(h('div', { class: 'advice' }, h('b', { text: a.t }), h('div', { text: a.b }))));
});
$('#btnAI').addEventListener('click', async () => {
  const key = $('#apikey').value.trim(), out = $('#aiOut');
  out.hidden = false;
  if (!key) { out.textContent = 'Paste your API key first.'; return; }
  const cmds = S.fw.settings.map(s => `${s.name}: ${s.combo}${s.range ? ' (range ' + s.range + ')' : ''}${s.unverified ? ' [unverified]' : ''}`).join('\n');
  const system = "You are a GameCube controller calibration coach for Super Smash Bros. Melee players using a PhobGCC. You get the player's problem and numeric measurements from guided stick tests (raw offsets from center; ~23 is the Melee deadzone edge, ~64 the smash threshold, ~80 full tilt). Interpret the numbers, name the most likely cause, and give a short ordered list of concrete steps. Use ONLY the button combos in the command list for the selected firmware; do not invent combos or ranges. Items marked [unverified] should be flagged as such. Tell the player to confirm in the official PhobGCC guide. Never invent measurements; if data is missing, say which test to run next. Be concise.";
  const content = `Firmware profile: ${S.fw.label}\nCommands:\n${cmds}\n\nProblem: ${$('#problem').value || '(none given)'}\n\nMeasurements (JSON):\n` + JSON.stringify({ test: S.last && S.last.mode, stick: S.last && S.last.which, summary: summarize(S.last ? S.last.results : {}) }, null, 1);
  out.textContent = 'Thinking…';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: $('#model').value.trim() || 'claude-sonnet-5-5', max_tokens: 900, system, messages: [{ role: 'user', content }] })
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || res.statusText);
    out.textContent = (j.content || []).map(b => b.text || '').join('\n').trim() || '(empty reply)';
  } catch (e) { out.textContent = 'Request failed: ' + e.message + '\nThe local coach above still works without a key.'; }
});

/* ================= guided setup ================= */
function comboEl(str, refs) {
  const wrap = h('div', { class: 'combo' });
  parseCombo(str).forEach((group, i) => {
    if (i) wrap.append(h('span', { class: 'plus', text: '+' }));
    wrap.append(h('span', { class: 'keys' }, group.map(k => {
      const el = h('span', { class: 'key', text: k });
      if (refs) refs.push({ el, alts: keyAlts(k) });
      return el;
    })));
  });
  return wrap;
}
function lightKeys(refs, held) {
  if (!refs) return;
  for (const r of refs) {
    const cls = 'key' + (r.alts.some(k => held.has(k)) ? ' on' : '');
    if (r.el.className !== cls) r.el.className = cls;
  }
}

/* ---- firmware auto-detect: the version command parks the C-stick on one exact value; watch for a steady 25-35 reading ---- */
const DETECT_COMBO = 'AZ + Du';
function startDetect() { S.detect = { phase: 'waiting', reader: new VersionReader(), result: null, match: null }; }
function feedDetect(t, s) {
  const d = S.detect;
  if (!d || d.phase !== 'waiting') return;
  const r = d.reader.feed(t, s.cx, s.cy);
  if (r) { d.phase = 'done'; d.result = r; d.match = matchFirmware(S.profiles, r.value); }
}
function detectMatch() {
  const d = S.detect;
  if (!d || d.phase !== 'done') return null;
  return d.match;
}
function detectMessage() {
  const d = S.detect;
  if (!S.source) return 'Connect the adapter first.';
  if (!d || d.phase === 'waiting') return 'Waiting for the version readout. Hold A + Z and press D-pad Up, then leave the C-stick alone. A steady C-stick reading of 25 to 35 held for half a second is taken as the version. If nothing happens, turn Safe Mode off (AXY + Start, hold about 1 second) and try again; no response usually means firmware 0.23 or older, which is not supported.';
  const m = detectMatch();
  return `C-stick ${d.result.axis.toUpperCase()} reads ${d.result.value}. ` + (m.profile ? `Matches ${m.profile.label}. ` : '') + (m.note || '');
}

/* ---- first-run / detect dialog ---- */
const fr = { keyRefs: null, status: null, apply: null };
function closeFirstRun() { store.set('firstRunDone', true); $('#firstRun').hidden = true; fr.keyRefs = null; }
function openFirstRun() {
  startDetect();
  const m = $('#firstRun'); m.hidden = false; m.textContent = '';
  fr.keyRefs = [];
  const sel = h('select', {}, S.profiles.map(p => h('option', { value: p.id, text: p.label })));
  sel.value = S.fw.id;
  fr.status = h('div', { class: 'livebox' });
  fr.apply = h('button', { class: 'primary', disabled: true, text: 'Use detected version', onclick: () => { const mt = detectMatch(); if (mt && mt.profile) { setFirmware(mt.profile.id); closeFirstRun(); } } });
  m.append(h('div', { class: 'modalcard' },
    h('h2', { text: 'Which firmware is your Phob running?' }),
    h('p', { class: 'mut small', text: 'Calibration and settings commands differ between firmware versions (0.25 to 0.31 are supported). Pick your version, or let the app read it from the controller.' }),
    h('div', { class: 'opt' }, h('h3', { text: 'I know my version' }),
      h('div', { class: 'row' }, sel, h('button', { class: 'primary', text: 'Use this version', onclick: () => { setFirmware(sel.value); closeFirstRun(); } }))),
    h('div', { class: 'opt' }, h('h3', { text: 'Detect it for me' }),
      h('div', { class: 'small mut' }, 'Connect the adapter, then hold A and Z and press D-pad Up on your Phob. The app watches the C-stick for the steady reading the controller shows (25 to 35, held half a second) and takes that as the version.'),
      h('div', { class: 'row', style: 'margin:8px 0' }, h('button', { text: 'Connect GC adapter', onclick: doConnectAdapter }), h('button', { text: 'Demo', onclick: doConnectDemo }), h('button', { text: 'Try again', onclick: startDetect })),
      comboEl(DETECT_COMBO, fr.keyRefs), fr.status, h('div', { class: 'row', style: 'margin-top:8px' }, fr.apply),
      h('div', { class: 'note', text: 'If nothing happens, turn Safe Mode off first (AXY + Start, hold about 1 second) and try again. No response usually means firmware 0.23 or older, which is not supported.' })),
    h('div', { class: 'row' }, h('button', { text: 'Decide later (keep ' + S.fw.label + ')', onclick: closeFirstRun }))));
}
function updateFirstRun() {
  if (!fr.keyRefs || $('#firstRun').hidden) return;
  lightKeys(fr.keyRefs, S.held);
  fr.status.textContent = detectMessage();
  const mt = detectMatch();
  fr.apply.disabled = !(mt && mt.profile);
  fr.apply.textContent = mt && mt.profile ? `Use ${mt.profile.label}` : 'Use detected version';
}
$('#btnDetectFw').addEventListener('click', openFirstRun);

function renderProcList() {
  const box = $('#procList'); box.textContent = '';
  S.fw.procedures.forEach(p => box.append(h('button', { class: 'proc' + (S.runner && S.runner.proc.id === p.id ? ' active' : ''), onclick: () => startProcedure(p.id) }, p.title, h('span', { class: 's', text: p.summary }))));
  const notes = $('#fwNotes'); notes.textContent = '';
  if (S.fw.notes && S.fw.notes.length) notes.append(h('b', { text: 'Notes for this firmware' }), h('ul', {}, S.fw.notes.map(n => h('li', { text: n }))));
}
function startProcedure(id) {
  const proc = S.fw.procedures.find(p => p.id === id);
  S.runner = new Runner(S.fw, proc);
  S.versionMatch = null; S.testPass = null; S.tracker.reset();
  renderProcList(); renderRunner();
}
function syncGuideStick() {
  const st = S.runner && !S.runner.finished ? S.runner.step : null;
  S.guideStick = st && st.kind === 'guide' ? st.guideStick : null;
  if (S.guideStick) S.tracker.configure({ total: st.presses || 32, startJumps: !!st.startJumps, advanceKeys: st.advanceKeys || ['L', 'R', 'A'] });
}

let live = {}; // refs to elements updated per frame
function renderRunner() {
  const box = $('#runner'); box.textContent = ''; live = { keyRefs: [] };
  syncGuideStick();
  const R = S.runner;
  if (!R) { box.append(h('div', { class: 'mut', text: 'Pick a walkthrough to begin.' })); return; }
  const prog = R.progress;
  box.append(h('h2', { text: R.proc.title }), h('div', { class: 'mut small', text: R.proc.summary }));
  if (S.fw.confidence !== 'official') box.append(h('div', { class: 'note' }, h('span', { class: 'chip warn', text: S.fw.confidence }), ' This profile is not fully verified. Check each combo against the guide for your firmware.'));
  const bar = h('div', { class: 'bar' }, h('div', { style: `width:${Math.round(prog.fraction * 100)}%` }));
  box.append(bar);
  if (R.finished) {
    box.append(h('div', { class: 'step' }, h('div', { class: 'n', text: 'Walkthrough complete' }), h('div', { text: 'Nice work. Use the History tab to compare before and after, or pick another walkthrough.' })),
      h('div', { class: 'row' }, h('button', { onclick: () => startProcedure(R.proc.id), text: 'Restart' })));
    return;
  }
  const st = R.step;
  const card = h('div', { class: 'step' },
    h('div', { class: 'n' }, `Step ${prog.index + 1} of ${prog.total}: ${st.title} `, st.unverified ? h('span', { class: 'chip warn', text: 'unverified' }) : null),
    st.combo ? comboEl(st.combo, live.keyRefs) : null,
    h('div', { text: st.text }),
    st.note ? h('div', { class: 'note', text: st.note }) : null);
  live.status = h('div', { class: 'livebox', text: '' });
  card.append(live.status);

  if (st.kind === 'guide') {
    live.bar = h('div', { class: 'bar' }, h('div', {}));
    live.prompt = h('div', { class: 'small' });
    card.append(live.bar, live.prompt);
  }
  if (st.kind === 'readVersion') {
    startDetect();
    live.apply = h('button', { class: 'primary', disabled: true, text: 'Use this profile', onclick: () => { if (S.versionMatch && S.versionMatch.profile) setFirmware(S.versionMatch.profile.id); } });
    card.append(h('div', { class: 'row', style: 'margin-top:8px' }, live.apply, h('button', { text: 'Try again', onclick: startDetect })));
  }
  if (st.kind === 'test') {
    live.testBtn = h('button', { class: 'primary', text: `Run ${TESTS[st.test.mode].name}`, onclick: () => runGuidedTest(st) });
    live.testStop = h('button', { class: 'danger', disabled: true, text: 'Stop', onclick: () => { if (S.stopRec) S.stopRec(); } });
    live.testCd = h('span', { class: 'countdown' });
    live.testOut = h('div', {});
    card.append(h('div', { class: 'mut small', style: 'margin-top:8px', text: TESTS[st.test.mode].text }), h('div', { class: 'row', style: 'margin-top:8px' }, live.testBtn, live.testStop, live.testCd), live.testOut);
    if (st.test.stick === 'c' || st.test.stick === 'left') $('#which').value = st.test.stick;
  }
  box.append(card);

  live.next = h('button', { class: 'primary', text: prog.index === prog.total - 1 ? 'Finish' : 'Next', onclick: () => advance() });
  live.skip = h('button', { text: 'Continue anyway', hidden: true, onclick: () => advance() });
  box.append(h('div', { class: 'row' }, h('button', { text: 'Back', disabled: prog.index === 0, onclick: () => { R.prev(); S.testPass = null; renderRunner(); } }), live.next, live.skip));
  updateGuideLive();
}
function advance() { S.runner.next(); S.testPass = null; renderRunner(); }

function updateGuideLive() {
  const R = S.runner;
  if (!R || R.finished || !live.status) return;
  const st = R.step;
  lightKeys(live.keyRefs, S.held);
  const restMs = S.restSince === null ? 0 : performance.now() - S.restSince;
  if (st.kind === 'readVersion') S.versionMatch = detectMatch();
  const tr = S.tracker;
  const g = { presses: tr.presses, total: tr.total, phase: tr.phase };
  const auto = stepAuto(st, { restMs, guide: g, versionMatch: S.versionMatch, testPass: S.testPass });
  let msg = auto.message;
  if (st.kind === 'readVersion') msg = detectMessage();
  else if (st.combo && S.source && S.source.hasButtons) {
    if (comboHeld(S.held, st.combo)) live.seen = true;
    if (live.seen) msg = (msg ? msg + ' ' : '') + 'Combo detected \u2713';
  }
  live.status.textContent = msg;
  if (live.bar) {
    live.bar.firstChild.style.width = Math.min(100, Math.round(100 * g.presses / g.total)) + '%';
    live.prompt.textContent = tr.prompt()
      + (tr.usingButtons ? ` Button presses counted: ${tr.btnPresses}; guide moves seen: ${tr.movePresses}.` : '')
      + (tr.mismatch ? ' Presses and guide movements disagree: you may have skipped or doubled a notch (Z goes back).' : '')
      + (tr.lastButton ? ` Last button: ${tr.lastButton}.` : '');
  }
  if (live.apply) live.apply.disabled = !(S.versionMatch && S.versionMatch.profile && S.versionMatch.profile.id !== S.fw.id);
  const need = st.kind !== 'manual';
  live.next.disabled = need && !auto.ready;
  live.skip.hidden = !(need && !auto.ready);
}

async function runGuidedTest(st) {
  if (S.testBusy) return;
  S.testBusy = true; S.testPass = null;
  live.testBtn.disabled = true; live.testStop.disabled = false;
  try {
    const r = await recordTest(st.test.mode, st.test.stick, l => { live.testCd.textContent = 'Recording ' + l.toFixed(1) + ' s'; });
    live.testCd.textContent = '';
    const ev = S.runner.evaluate(r.results);
    S.testPass = ev.pass;
    S.last = r; $('#btnJson').disabled = $('#btnCsv').disabled = !r.pts.length;
    const diff = saveHistory(r, 'guide:' + S.runner.proc.id); renderHistory();
    live.testOut.textContent = '';
    const cv = h('canvas', { width: 420, height: 420, style: 'max-width:260px;margin:8px 0' });
    live.testOut.append(cv);
    drawRecording(cv, r.pts, r.results);
    ev.checks.forEach(c => live.testOut.append(h('div', { class: 'metric' },
      h('div', { class: 'l', text: c.label }),
      h('div', { style: 'text-align:right' }, h('span', { class: 'chip ' + (c.missing ? 'off' : c.pass ? 'ok' : 'bad'), text: c.missing ? 'no data' : `${rnd(c.value)} ${c.op} ${c.target}` })))));
    if (diff.length) live.testOut.append(h('div', { class: 'note' }, 'Since the previous run: ', diff.map(d => h('span', { class: 'delta ' + (d.better === true ? 'good' : d.better === false ? 'badx' : ''), text: `${d.label} ${d.before} → ${d.after}; ` }))));
  } catch (e) { setStatus(e.message, 'bad'); }
  S.testBusy = false;
  if (live.testBtn) { live.testBtn.disabled = false; live.testStop.disabled = true; }
}

/* ================= reference ================= */
function renderRef() {
  const q = ($('#refSearch').value || '').toLowerCase();
  const rows = S.fw.settings.filter(s => !q || JSON.stringify(s).toLowerCase().includes(q));
  const box = $('#refTable'); box.textContent = '';
  const t = h('table', { class: 'ref' }, h('tr', {}, ['Setting', 'Combo', 'Range / default', 'Display / notes'].map(x => h('th', { text: x }))));
  rows.forEach(s => t.append(h('tr', {},
    h('td', {}, s.name, s.unverified ? [' ', h('span', { class: 'chip warn', text: 'unverified' })] : null),
    h('td', {}, comboEl(s.combo)),
    h('td', { text: [s.range, s.def !== undefined ? `default ${s.def}` : ''].filter(Boolean).join(', ') }),
    h('td', { text: [s.display, s.notes].filter(Boolean).join(' · ') }))));
  box.append(t);
  if (!rows.length) box.append(h('p', { class: 'mut', text: 'No matches.' }));
}
$('#refSearch').addEventListener('input', renderRef);

/* ================= history ================= */
function renderHistory() {
  const hist = store.get('history', []);
  const box = $('#histList'); box.textContent = '';
  if (!hist.length) { box.append(h('p', { class: 'mut', text: 'No tests recorded yet.' })); return; }
  hist.forEach((e, i) => {
    const prev = hist.slice(i + 1).find(x => x.test === e.test && x.stick === e.stick);
    const diff = prev ? diffMetrics(prev.metrics, e.metrics) : [];
    box.append(h('div', { class: 'hist' },
      h('div', {}, h('b', { text: TESTS[e.test] ? TESTS[e.test].name : e.test }), ` · ${e.stick === 'c' ? 'C-stick' : 'control stick'} · ${new Date(e.ts).toLocaleString()} · fw ${e.fw}`),
      h('div', { class: 'mut small', text: Object.entries(e.metrics).map(([k, v]) => `${k} ${v}`).join('  ') || 'no metrics (not enough data)' }),
      diff.length ? h('div', { class: 'small' }, 'vs previous: ', diff.map(d => h('span', { class: 'delta ' + (d.better === true ? 'good' : d.better === false ? 'badx' : ''), text: `${d.label} ${d.before} → ${d.after}; ` }))) : null));
  });
}
$('#btnClearHist').addEventListener('click', () => { store.set('history', []); renderHistory(); });

/* ================= snapshots ================= */
const snapStore = makeSnapshotStore({ tauri: globalThis.__TAURI__, local: (() => { try { return localStorage; } catch (e) { return null; } })() });
const SNAP = { list: [], sel: null, draft: null, msg: '', busy: false, confirmDel: false };
// Element.append does not expand arrays or skip nulls, so flatten and filter children first.
const put = (box, ...kids) => box.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
const fmtDate = ts => new Date(ts).toLocaleString();
const stickName = s => (s === 'c' ? 'C-stick' : 'Control stick');
const TEST_ORDER = ['rest', 'rotate', 'release', 'flick'];

async function persistSnapshots() {
  try { await snapStore.save(SNAP.list); return true; }
  catch (e) { SNAP.msg = 'Could not save snapshots: ' + (e && e.message ? e.message : e); return false; }
}
function metricLine(snap) {
  const m = snapshotMetrics(snap);
  return METRICS.filter(x => x.key in m).map(x => `${x.label} ${m[x.key]}`).join(' · ') || 'no measurements';
}
function draftFrom(snap) {
  return {
    id: snap ? snap.id : null, isNew: !snap, createdAt: snap ? snap.createdAt : Date.now(),
    name: snap ? snap.name : '', description: snap ? snap.description : '', rating: snap ? snap.rating : 0,
    stick: snap ? snap.stick : 'left', fw: snap ? snap.fw : S.fw.id, origin: snap ? snap.origin : null,
    naNotches: new Set(snap ? snap.naNotches : []),
    settings: snap ? snap.settings.map(x => ({ ...x })) : settingsSheet(S.fw),
    measurements: snap ? JSON.parse(JSON.stringify(snap.measurements)) : {}
  };
}
function renderSnapshots() {
  $('#snapStorage').textContent = snapStore.kind === 'file' ? 'Saved to a file in the app data folder.' : 'Saved in this browser (desktop app: a file in the app data folder).';
  const list = $('#snapList'); list.textContent = '';
  if (!SNAP.list.length) list.append(h('p', { class: 'mut', text: 'No snapshots yet.' }));
  SNAP.list.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(sn => {
    list.append(h('button', { class: 'snap' + (SNAP.sel === sn.id && !SNAP.draft ? ' active' : ''), onclick: () => { if (SNAP.busy) return; SNAP.sel = sn.id; SNAP.draft = null; SNAP.confirmDel = false; renderSnapshots(); } },
      h('b', { text: sn.name }), ' ', h('span', { class: 'stars', text: stars(sn.rating) }),
      h('span', { class: 's', text: `${fmtDate(sn.createdAt)} · ${stickName(sn.stick)} · fw ${sn.fw || '?'}` }),
      sn.description ? h('span', { class: 's', text: sn.description.length > 90 ? sn.description.slice(0, 90) + '…' : sn.description }) : null));
  });
  const box = $('#snapDetail'); box.textContent = '';
  if (SNAP.msg) box.append(h('div', { class: 'note', text: SNAP.msg }));
  if (SNAP.draft) renderSnapEditor(box);
  else if (SNAP.sel && SNAP.list.find(x => x.id === SNAP.sel)) renderSnapView(box, SNAP.list.find(x => x.id === SNAP.sel));
  else box.append(h('div', { class: 'mut', text: 'Select a snapshot, or create a new one.' }));
}
function notchTable(snap) {
  const rot = snap.measurements.rotation; if (!rot) return null;
  const na = new Set(snap.naNotches);
  return h('table', { class: 'notches' },
    h('tr', {}, h('th', { text: 'Notch' }), h('th', { text: 'Angle error' }), h('th', { text: 'Radius' })),
    rot.notches.map(n => h('tr', { class: na.has(n.k) ? 'na' : '' }, h('td', { text: n.name + (na.has(n.k) ? ' (N/A)' : '') }),
      h('td', { text: n.missing ? 'no data' : rnd(n.angErr, 1) + '°' }), h('td', { text: n.missing ? '' : rnd(n.r, 1) }))));
}
function renderSnapView(box, sn) {
  const res = snapshotResults(sn);
  put(box,
    h('h2', {}, sn.name, ' ', h('span', { class: 'stars', text: stars(sn.rating) })),
    h('div', { class: 'mut small', text: `${fmtDate(sn.createdAt)} · ${stickName(sn.stick)} · firmware ${sn.fw || '?'}` }),
    sn.description ? h('p', { text: sn.description }) : null,
    h('div', { class: 'row', style: 'margin:8px 0' },
      h('button', { onclick: () => { SNAP.draft = draftFrom(sn); SNAP.msg = ''; renderSnapshots(); } }, 'Edit'),
      h('button', { onclick: () => download(`snapshot-${sn.name.replace(/[^\w-]+/g, '_')}.json`, serializeStore([sn]), 'application/json') }, 'Export'),
      h('button', { class: 'danger', onclick: async () => {
        if (!SNAP.confirmDel) { SNAP.confirmDel = true; renderSnapshots(); return; }
        SNAP.list = SNAP.list.filter(x => x.id !== sn.id); SNAP.sel = null; SNAP.confirmDel = false; SNAP.msg = '';
        await persistSnapshots(); renderSnapshots();
      } }, SNAP.confirmDel ? 'Click again to delete' : 'Delete')),
    h('h3', { text: 'Measurements' }),
    h('div', { class: 'small', text: metricLine(sn) }),
    res.rotation && res.rotation.missing.length ? h('div', { class: 'note', text: 'No data near: ' + res.rotation.missing.join(', ') + '.' }) : null,
    notchTable(sn),
    h('h3', { style: 'margin-top:12px', text: 'Settings' }),
    sn.settings.length ? sn.settings.map(x => h('div', { class: 'small' }, h('b', { text: x.name + ': ' }), x.value === '' ? 'not set' : x.value, h('span', { class: 'mut', text: `  (${x.combo}, range ${x.range})` }))) : h('div', { class: 'mut small', text: 'No settings recorded.' }));
}
function renderSnapEditor(box) {
  const d = SNAP.draft;
  const busy = () => SNAP.busy;
  const name = h('input', { type: 'text', placeholder: 'e.g. After recalibration, 0.31' }); name.value = d.name;
  name.addEventListener('input', () => { d.name = name.value; });
  const desc = h('textarea', { placeholder: 'What changed, how it plays, which shell/springs...' }); desc.value = d.description;
  desc.addEventListener('input', () => { d.description = desc.value; });
  const starRow = h('span', {});
  const drawStars = () => { starRow.textContent = ''; for (let i = 1; i <= 5; i++) starRow.append(h('button', { class: 'starbtn', title: i + ' of 5', onclick: () => { d.rating = d.rating === i ? 0 : i; drawStars(); } }, i <= d.rating ? '★' : '☆')); };
  drawStars();
  const stickSel = h('select', {}, h('option', { value: 'left', text: 'Control stick' }), h('option', { value: 'c', text: 'C-stick' }));
  stickSel.value = d.stick;
  stickSel.addEventListener('change', () => { d.stick = stickSel.value; d.measurements = {}; renderSnapshots(); });
  if (!d.isNew) stickSel.disabled = true;

  const nagrid = h('div', { class: 'nagrid' }, DIRS.map((nm, k) => {
    const cb = h('input', { type: 'checkbox' }); cb.checked = d.naNotches.has(k);
    cb.addEventListener('change', () => { if (cb.checked) d.naNotches.add(k); else d.naNotches.delete(k); });
    return h('label', {}, cb, nm);
  }));

  const rows = TEST_ORDER.map(mode => {
    const key = BLOCK_OF[mode], have = d.measurements[key];
    const status = h('span', { class: 'mut small', text: have ? 'recorded' : 'not recorded' });
    const btn = h('button', { text: have ? 'Re-record' : 'Record', onclick: async () => {
      if (busy()) return;
      SNAP.busy = true; btn.disabled = true;
      try {
        const r = await recordTest(mode, d.stick, l => { status.textContent = 'Recording ' + l.toFixed(1) + ' s'; });
        const blk = compactBlock(mode, r.results);
        if (blk) { d.measurements[key] = blk; SNAP.msg = ''; } else SNAP.msg = `Not enough data from the ${TESTS[mode].name} test. Try again.`;
      } catch (e) { SNAP.msg = e.message; }
      SNAP.busy = false; renderSnapshots();
    } });
    const clear = have ? h('button', { text: 'Clear', onclick: () => { if (busy()) return; delete d.measurements[key]; renderSnapshots(); } }) : null;
    return h('div', { class: 'testrow' }, h('span', { class: 'nm', text: TESTS[mode].name }), btn, clear, status,
      h('div', { class: 'mut small', style: 'flex-basis:100%', text: TESTS[mode].text }));
  });

  const setRows = d.settings.map(st => {
    const inp = h('input', { type: 'text' }); inp.value = st.value;
    inp.addEventListener('input', () => { st.value = inp.value; });
    return h('div', { class: 'setrow' }, h('span', { text: st.name }), inp, h('span', { class: 's', text: `${st.combo} · range ${st.range}` }));
  });

  const save = h('button', { class: 'primary', text: d.isNew ? 'Save snapshot' : 'Save changes', onclick: async () => {
    if (busy()) return;
    const snap = createSnapshot({ ...d, naNotches: [...d.naNotches], origin: d.origin || originNow() });
    const bad = validateSnapshot(snap);
    if (bad.length) { SNAP.msg = 'Cannot save: ' + bad.join(', '); renderSnapshots(); return; }
    const i = SNAP.list.findIndex(x => x.id === snap.id);
    if (i >= 0) SNAP.list[i] = snap; else SNAP.list.unshift(snap);
    SNAP.sel = snap.id; SNAP.draft = null; SNAP.msg = '';
    if (!(await persistSnapshots())) SNAP.draft = d;
    renderSnapshots();
  } });
  put(box,
    h('h2', { text: d.isNew ? 'New snapshot' : 'Edit snapshot' }),
    h('label', { class: 'field' }, h('span', { text: 'Name' }), name),
    h('label', { class: 'field' }, h('span', { text: 'Description' }), desc),
    h('div', { class: 'field' }, h('span', { class: 'mut small', text: 'Rating (how it plays)' }), starRow),
    h('label', { class: 'field' }, h('span', { text: 'Stick' }), stickSel),
    h('h3', { text: 'Notches this shell does not have' }),
    h('div', { class: 'mut small', text: 'Tick any direction with no physical notch. It is left out of the measurements and of later drift checks.' }),
    nagrid,
    h('h3', { style: 'margin-top:14px', text: 'Measurements' }),
    h('div', { class: 'mut small', text: 'Connect the adapter, then record each test for the stick above. Every test is optional; record the ones you care about.' }),
    rows,
    h('h3', { style: 'margin-top:14px', text: `Settings (${S.fw.label})` }),
    h('div', { class: 'mut small', text: 'The controller cannot report its settings to this app, so enter what you set. Defaults are filled in.' }),
    setRows.length ? setRows : h('div', { class: 'mut small', text: 'This firmware profile has no numeric settings.' }),
    h('div', { class: 'row', style: 'margin-top:14px' }, save, h('button', { text: 'Cancel', onclick: () => { if (busy()) return; SNAP.draft = null; SNAP.msg = ''; renderSnapshots(); } })));
}
const originNow = () => (S.source && S.source.origin ? S.source.origin() : null);

$('#btnSnapNew').addEventListener('click', () => { if (SNAP.busy) return; SNAP.draft = draftFrom(null); SNAP.sel = null; SNAP.msg = ''; renderSnapshots(); });
$('#btnSnapExport').addEventListener('click', () => { if (SNAP.list.length) download('stick-coach-snapshots.json', serializeStore(SNAP.list), 'application/json'); });
$('#btnSnapImport').addEventListener('click', () => $('#fileSnapImport').click());
$('#fileSnapImport').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const r = mergeImported(SNAP.list, await f.text());
  SNAP.list = r.list;
  SNAP.msg = `Imported ${r.added} snapshot(s)` + (r.skipped ? `, ${r.skipped} already present` : '') + '.' + (r.errors.length ? ' ' + r.errors.join(' ') : '');
  await persistSnapshots(); e.target.value = ''; renderSnapshots();
});
snapStore.load().then(r => { SNAP.list = r.snapshots; if (r.errors.length) SNAP.msg = r.errors.join(' '); renderSnapshots(); })
  .catch(e => { SNAP.msg = 'Could not load snapshots: ' + (e && e.message ? e.message : e); renderSnapshots(); });

/* ================= updates ================= */
const tauriApi = globalThis.__TAURI__;
let updating = false;
function showUpdateBar(update) {
  const bar = $('#updateBar'); bar.textContent = ''; bar.hidden = false;
  const msg = h('span', { text: `Version ${update.version} is available.` });
  const install = h('button', { class: 'primary', text: 'Install and restart', onclick: async () => {
    if (updating) return; updating = true; install.disabled = true;
    try { await installUpdate(tauriApi, update, m => { msg.textContent = m; }); }
    catch (e) {
      updating = false; install.disabled = false;
      msg.textContent = 'Could not install automatically (' + (e && e.message ? e.message : e) + '). ';
      msg.append(h('a', { href: RELEASES_URL, target: '_blank', rel: 'noopener', text: 'Download the new version' }), '.');
    }
  } });
  bar.append(msg, install, h('button', { text: 'Later', onclick: () => { bar.hidden = true; } }));
}
async function runUpdateCheck(manual) {
  const out = $('#updateMsg');
  if (manual) out.textContent = 'Checking...';
  try {
    const update = await checkForUpdate(tauriApi);
    if (update) { showUpdateBar(update); if (manual) out.textContent = `Version ${update.version} is available.`; }
    else if (manual) out.textContent = 'You are up to date.';
  } catch (e) { if (manual) out.textContent = 'Could not check for updates: ' + (e && e.message ? e.message : e); }
}
if (updaterAvailable(tauriApi)) {
  $('#updateCard').hidden = false;
  $('#btnUpdate').addEventListener('click', () => runUpdateCheck(true));
  if (tauriApi.app && tauriApi.app.getVersion) tauriApi.app.getVersion().then(v => { $('#appVersion').textContent = v; }).catch(() => { });
  setTimeout(() => runUpdateCheck(false), 4000); // quiet check shortly after launch; offline or no release is not an error
}

/* ================= tabs / init ================= */
function showPage(name) {
  S.page = name;
  $$('.page').forEach(p => { p.hidden = p.id !== 'page-' + name; });
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'guide') { syncGuideStick(); }
  else S.guideStick = null;
}
$$('#tabs button').forEach(b => b.addEventListener('click', () => showPage(b.dataset.tab)));

loadProfiles(); renderFwSelect(); renderProcList(); renderRef(); renderRunner(); renderHistory(); renderSnapshots();
if (!store.get('firstRunDone', false)) openFirstRun();
requestAnimationFrame(frame);
