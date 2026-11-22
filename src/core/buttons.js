// GameCube button decoding from the adapter packet, edge tracking and combo matching.
import { parseCombo } from './guide.js';

// Adapter packet: buttons1 = A B X Y DLeft DRight DDown DUp (bits 0-7), buttons2 = Start Z R L (bits 0-3).
export function decodeButtons(b1, b2) {
  const s = new Set();
  if (b1 & 0x01) s.add('A'); if (b1 & 0x02) s.add('B'); if (b1 & 0x04) s.add('X'); if (b1 & 0x08) s.add('Y');
  if (b1 & 0x10) s.add('Dl'); if (b1 & 0x20) s.add('Dr'); if (b1 & 0x40) s.add('Dd'); if (b1 & 0x80) s.add('Du');
  if (b2 & 0x01) s.add('Start'); if (b2 & 0x02) s.add('Z'); if (b2 & 0x04) s.add('R'); if (b2 & 0x08) s.add('L');
  return s;
}

const ALIAS = { 'Left D-Pad': 'Dl', 'Right D-Pad': 'Dr', 'Up D-Pad': 'Du', 'Down D-Pad': 'Dd' };
const ANY = { 'X/Y': ['X', 'Y'], 'A/B': ['A', 'B'], 'Du/Dd': ['Du', 'Dd'], 'L/R': ['L', 'R'], 'L/R/A': ['L', 'R', 'A'] };

// "A + X/Y + Du/Dd" -> [['A'],['X','Y'],['Du','Dd']]: each requirement is satisfied by any one listed key.
export function comboRequirements(str) {
  return parseCombo(str).flat().map(k => ANY[k] || [ALIAS[k] || k]);
}
export function comboHeld(held, str) {
  return comboRequirements(str).every(alts => alts.some(k => held.has(k)));
}

export class ButtonTracker {
  constructor() { this.held = new Set(); }
  update(next) {
    const down = [...next].filter(k => !this.held.has(k));
    const up = [...this.held].filter(k => !next.has(k));
    this.held = next;
    return { down, up };
  }
}

export const keyAlts = k => ANY[k] || [ALIAS[k] || k];

// Inverse of decodeButtons (used by the keyboard-driven demo source).
export function encodeButtons(set) {
  let b1 = 0, b2 = 0;
  const m1 = { A: 0x01, B: 0x02, X: 0x04, Y: 0x08, Dl: 0x10, Dr: 0x20, Dd: 0x40, Du: 0x80 };
  const m2 = { Start: 0x01, Z: 0x02, R: 0x04, L: 0x08 };
  for (const k of set) { if (m1[k]) b1 |= m1[k]; if (m2[k]) b2 |= m2[k]; }
  return [b1, b2];
}
