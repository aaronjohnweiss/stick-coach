// Walkthrough helpers: combo parsing, live guide-stick tracking, firmware detection.
import { hyp, angleOf, angDiff, dirName, rnd } from './analysis.js';

const NAMED = new Set(['Start', 'Du', 'Dd', 'Dl', 'Dr', 'X/Y', 'A/B', 'L/R', 'L/R/A', 'Du/Dd']);

// "AXY + Start" -> [['A','X','Y'],['Start']] ; text tokens (e.g. "Left D-Pad") stay whole.
export function parseCombo(s) {
  return s.split('+').map(p => p.trim()).filter(Boolean).map(tok =>
    (NAMED.has(tok) || !/^[ABXYLRZ]+$/.test(tok)) ? [tok] : tok.split(''));
}

// Tracks calibration progress. While calibrating, the controller freezes the stick being calibrated and the *other*
// stick shows a guide position (center, then a notch, then center ...). Two signals are combined:
//  - real button presses from the adapter (L / R / A advance, Z goes back), the primary count when available;
//  - guide movements (each stable change of the guide position), used as a fallback and as a cross-check.
export class GuideTracker {
  constructor({ stableMs = 150, centerR = 12, rimR = 50, total = 32, startJumps = false, advanceKeys = ['L', 'R', 'A'] } = {}) {
    Object.assign(this, { stableMs, centerR, rimR, total, startJumps, advanceKeys });
    this.reset();
  }
  configure({ total = 32, startJumps = false, advanceKeys = ['L', 'R', 'A'] } = {}) { this.total = total; this.startJumps = startJumps; this.advanceKeys = advanceKeys; this.reset(); }
  reset() {
    this.cls = null; this.since = 0; this.stable = null; this.movePresses = 0; this.btnPresses = 0;
    this.jumped = false; this.lastButton = null; this.history = [];
  }
  classify(x, y) {
    const r = hyp(x, y);
    if (r < this.centerR) return 'center';
    if (r < this.rimR) return null; // moving
    const a = angleOf(x, y);
    const nearest = Math.round(a / 45) * 45;
    if (Math.abs(angDiff(a, nearest)) <= 12) return dirName(a);
    return 'modder ' + (Math.round(a / 5) * 5 % 360) + '°';
  }
  // returns true when a new stable guide position was registered
  feed(t, x, y) {
    const c = this.classify(x, y);
    if (c !== this.cls) { this.cls = c; this.since = t; return false; }
    if (c === null || c === this.stable || t - this.since < this.stableMs) return false;
    const first = this.stable === null;
    this.stable = c;
    this.history.push({ t, cls: c });
    // The guide starts centered. If our first observation is already a notch, one move (center -> notch) was missed.
    if (!first || c !== 'center') this.movePresses++;
    return true;
  }
  // keys: buttons that went down since the last sample
  pressKeys(keys) {
    for (const k of keys) {
      this.lastButton = k;
      if (this.phase !== 'measure') continue;
      if (this.advanceKeys.includes(k)) this.btnPresses++;
      else if (k === 'Z') this.btnPresses = Math.max(0, this.btnPresses - 1);
      else if (k === 'Start' && this.startJumps) this.jumped = true;
    }
  }
  get usingButtons() { return this.btnPresses > 0; }
  get presses() { return this.usingButtons ? this.btnPresses : this.movePresses; }
  get phase() { return (this.jumped || this.presses >= this.total) ? 'adjust' : 'measure'; }
  // True when button presses and guide movements disagree noticeably (e.g. a skipped notch).
  get mismatch() { return this.usingButtons && Math.abs(this.btnPresses - this.movePresses) > 2; }
  advanceText() { const k = this.advanceKeys; return k.length > 1 ? k.slice(0, -1).join(', ') + ' or ' + k[k.length - 1] : k[0]; }
  prompt() {
    if (this.phase === 'adjust') return 'Measurement presses complete. Now in the notch-adjustment phase: use X / Y to shift each notch, then press ' + this.advanceText() + ' to move on. Calibration saves when the guide returns to center.';
    if (this.stable === null) return 'Waiting for the guide stick to settle...';
    if (this.stable === 'center') return 'Guide is centered: release your stick, then press ' + this.advanceText() + '.';
    return `Guide is on the ${this.stable} notch: hold your stick into that notch (enter it the way you would in game), then press ${this.advanceText()}. No notch there? Release the stick and press ${this.advanceText()}.`;
  }
}

// Reads the firmware version the controller shows on the C-stick after the version command (AZ + Du).
// Per the guides the C-stick Y axis shows the tens and ones digits (29 for 0.29) and X the hundreds (0). While the
// controller processes any command it first freezes both sticks pointing up-right at 127/127, which must be ignored.
// Start it when the combo is first held; it watches for a steady two-digit value.
// The firmware version command holds the C-stick perfectly still at an offset equal to the version number
// (Y = tens and ones, e.g. 31 for 0.31). A human cannot hold a stick on one exact value for half a second, so a
// steady reading in [min, max] on either axis is taken as the version. No button input is needed.
export class VersionReader {
  constructor({ holdMs = 500, min = 25, max = 35 } = {}) { Object.assign(this, { holdMs, min, max }); this.reset(); }
  reset() { this.run = { y: null, x: null }; this.result = null; }
  feed(t, cx, cy) {
    if (this.result) return null;
    for (const [axis, raw] of [['y', cy], ['x', cx]]) {
      const v = Math.round(raw), r = this.run[axis];
      if (v < this.min || v > this.max) { this.run[axis] = null; continue; }
      if (!r || r.value !== v) { this.run[axis] = { value: v, since: t }; continue; }
      if (t - r.since >= this.holdMs) return (this.result = { value: v, axis, responded: true });
    }
    return null;
  }
}

// Match the version reading shown by the firmware version command to a known profile.
export function matchFirmware(profiles, raw) {
  const v = Math.round(raw);
  if (Math.abs(v) <= 1) {
    return { profile: null, value: v, confidence: 'none', note: 'No version response: the command may not have registered (try again, or turn Safe Mode off first), or the firmware is 0.23 or older, which this app does not support.' };
  }
  for (const [delta, confidence] of [[0, 'exact'], [1, 'near'], [-1, 'near']]) {
    const p = profiles.find(pr => (pr.versionNumbers || []).includes(v + delta));
    if (p) return { profile: p, value: v, confidence, note: confidence === 'near' ? 'Off by one from a known version; stick offsets can differ by 1 between adapters, so confirm manually.' : '' };
  }
  return { profile: null, value: v, confidence: 'unknown', note: `Reading ${rnd(v, 0)} does not match a bundled firmware profile.` };
}
