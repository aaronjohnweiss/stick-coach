// Smoke test: loads src/app.js against a minimal fake DOM and drives the demo source, a recording,
// the calibration walkthrough (with a simulated guide stick) and the reference/history pages.
// It cannot check layout or WebUSB; it catches runtime errors in the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag; this.nodeType = 1; this.children = []; this.listeners = {}; this.attrs = {};
    this.style = {}; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.className = '';
    this.width = 420; this.height = 420; this._text = '';
    this.classList = { toggle() { }, add() { }, remove() { } };
  }
  get firstChild() { return this.children[0] || new FakeEl(); }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  set innerHTML(v) { this.children = []; this._text = String(v); }
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 3) this._text += k.text; else if (k) this.children.push(k); } }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, ev = {}) { for (const f of this.listeners[t] || []) f(ev); }
  click() { this.fire('click'); }
  remove() { }
  setPointerCapture() { }
  getBoundingClientRect() { return { left: 0, top: 0, width: 420, height: 420 }; }
  getContext() { return new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => { }), set: (t, p, v) => { t[p] = v; return true; } }); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find && c.find(pred, out)); return out; }
}

const registry = {};
const docListeners = {};
const doc = {
  body: new FakeEl('body'),
  createElement: tag => new FakeEl(tag),
  createTextNode: text => ({ nodeType: 3, text }),
  querySelector: sel => (registry[sel] = registry[sel] || new FakeEl()),
  addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
  querySelectorAll: sel => (sel === '#tabs button' ? tabs : sel === '.page' ? pages : [])
};
const tabs = ['live', 'guide', 'ref', 'hist', 'help'].map(n => { const b = new FakeEl('button'); b.dataset.tab = n; return b; });
const pages = ['live', 'guide', 'ref', 'hist', 'help'].map(n => { const p = new FakeEl('section'); p.id = 'page-' + n; return p; });
const mem = {};
globalThis.document = doc;
globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
let rafOn = true;
globalThis.requestAnimationFrame = cb => { if (rafOn) setTimeout(cb, 16).unref(); };
globalThis.URL.createObjectURL = () => 'blob:fake';

const $ = s => doc.querySelector(s);

test('app boots, runs a demo recording, history and reference render', async () => {
  await import('../src/app.js');
  assert.ok($('#fwSel').children.length >= 3, 'firmware options rendered');
  assert.ok($('#procList').children.length >= 5, 'procedures listed');
  assert.ok($('#refTable').children.length === 1, 'reference table rendered');

  await $('#btnDemo').fire('click');
  await sleep(60);
  $('#testSel').value = 'free'; $('#which').value = 'left';
  $('#btnStart').click();
  // fake a drag + release in the control stick box during the recording
  const cv = $('#cvL');
  for (let rep = 0; rep < 3; rep++) {
    cv.fire('pointerdown', { pointerId: 1, clientX: 420 * (0.5 + 0.40), clientY: 210 });
    await sleep(120);
    cv.fire('pointerup', { clientX: 420 * 0.9, clientY: 210 });
    await sleep(200);
  }
  $('#btnStop').click();
  await sleep(50);
  assert.ok($('#findings').children.length > 0, 'findings rendered');
  assert.equal($('#btnJson').disabled, false);
  assert.ok(JSON.parse(mem.history).length >= 1, 'history saved');
  $('#btnCoach').click();
  assert.ok($('#advice').children.length > 0, 'coach produced advice');
});

test('calibration walkthrough end to end with a simulated guide', async () => {
  tabs[1].click(); // open the Guided Setup tab so the per-frame updates run
  // start "Calibrate the control stick" (second procedure for 0.31)
  const proc = $('#procList').children[1];
  proc.click();
  const runner = () => $('#runner');
  const text = () => runner().textContent;
  assert.match(text(), /Calibrate the control stick/);
  const buttons = () => runner().find(e => e.tag === 'button');
  const btn = label => buttons().find(b => b.textContent === label);

  // step 1 wake (manual) -> Next
  assert.match(text(), /Wake the sticks/);
  btn('Next').click();
  // step 2 rest: Next disabled until the stick has been still for 500 ms
  assert.match(text(), /Leave both sticks untouched/);
  await sleep(900);
  assert.equal(btn('Next').disabled, false, 'rest step becomes ready');
  btn('Next').click();
  // configure + start (manual)
  assert.match(text(), /Enter Configure Mode/);
  assert.match(text(), /Start/); // combo chips render
  btn('Next').click();
  assert.match(text(), /Start calibration/);
  btn('Next').click();
  // guide step: simulate the C-stick guide visiting 16 notch/center pairs
  assert.match(text(), /Measurement phase/);
  assert.equal(btn('Next').disabled, true, 'guide step gated');
  const gc = $('#cvGC');
  const k = (420 / 2 - 14) / 115;
  const at = (x, y) => ({ pointerId: 2, clientX: 210 + x * k, clientY: 210 - y * k });
  const notches = [[100, 0], [70, 70], [0, 100], [-70, 70], [-100, 0], [-70, -70], [0, -100], [70, -70]];
  for (let rep = 0; rep < 2; rep++) for (const [x, y] of notches) {
    gc.fire('pointerdown', at(x, y)); await sleep(260);
    gc.fire('pointerup', at(0, 0)); await sleep(260);
  }
  await sleep(100);
  assert.equal(btn('Next').disabled, false, 'guide step ready after 32 movements');
  btn('Next').click();
  assert.match(text(), /Notch adjustment phase/);
  btn('Next').click();
  assert.match(text(), /Verify with a gate rotation/);
  assert.ok(btn('Run Rotate the gate'), 'test button present');
  // skip the test (not enough data from a demo mouse) via "Continue anyway"
  assert.equal(btn('Next').disabled, true);
  assert.equal(btn('Continue anyway').hidden, false);
  btn('Continue anyway').click();
  assert.match(text(), /Return to Safe Mode/);
  btn('Finish').click();
  assert.match(text(), /Walkthrough complete/);
});

test('firmware switch, legacy and derived walkthroughs render, import validation', async () => {
  for (const id of ['0.29', '0.25', '0.31']) {
    $('#fwSel').value = id;
    $('#fwSel').fire('change', { target: $('#fwSel') });
    $('#procList').children[0].click ? $('#procList').children[0].click() : null;
    assert.ok($('#runner').textContent.length > 0, `runner renders for ${id}`);
    assert.ok($('#refTable').children.length === 1);
  }
  // reference filter
  $('#refSearch').value = 'snap';
  $('#refSearch').fire('input');
  // history clear
  $('#btnClearHist').click();
  assert.equal(JSON.parse(mem.history).length, 0);
});

test('first-run dialog: manual pick and C-stick auto-detect', async () => {
  try { await firstRunBody(); } finally { rafOn = false; await $('#btnDisc').fire('click'); await sleep(30); }
});

async function firstRunBody() {
  const modal = $('#firstRun');
  assert.equal(modal.hidden, false, 'first-run dialog opens on first launch');
  assert.match(modal.textContent, /Which firmware is your Phob running/);
  await $('#btnDemo').fire('click');
  await sleep(60);
  const key = (k, down) => { for (const f of docListeners[down ? 'keydown' : 'keyup'] || []) f({ key: k }); };
  // the controller shows the version on C-stick Y (29 -> 0.29); it must be held steady for ~500 ms
  const gc = $('#cvGC');
  const k = (420 / 2 - 14) / 115;
  gc.fire('pointerdown', { pointerId: 3, clientX: 210, clientY: 210 - 29 * k });
  await sleep(150);
  assert.match(modal.textContent, /Waiting for the version readout/, 'not accepted before the hold time');
  await sleep(900);
  gc.fire('pointerup', {});
  await sleep(50);
  assert.match(modal.textContent, /Matches Firmware 0\.29/);
  const apply = modal.find(e => e.tag === 'button' && /^Use Firmware 0\.29/.test(e.textContent))[0];
  assert.ok(apply && apply.disabled === false, 'apply button enabled');
  apply.click();
  assert.equal(modal.hidden, true);
  assert.equal(JSON.parse(mem.fw), '0.29');
  assert.equal(JSON.parse(mem.firstRunDone), true);
  // restore the latest profile for later checks
  $('#fwSel').value = '0.31'; $('#fwSel').fire('change', { target: $('#fwSel') });
}
