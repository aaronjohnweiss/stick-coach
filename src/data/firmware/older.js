// Legacy firmware 0.25 - 0.29, transcribed from the per-version guides in PhobGCC-doc/For_Users.
// (0.30 was never released; the project skipped it because of widespread beta builds.)
// Anything the guide itself was inconsistent about is flagged "unverified".
import { makeProfile } from './common.js';

const L_R_A = { advance: 'L, R or A', adjustNext: 'L, R or A', advanceKeys: ['L', 'R', 'A'], presses: 32, startJumps: true };
const JUMP_FULL = [{ id: 'jump', name: 'Trigger jump (swap X/Y with Z, L or R)', combo: 'XZ + Start', notes: 'Also YZ + Start (Z), LX / LY + Start (L), RX / RY + Start (R). Press the same combo again to swap back. With L or R, X/Y acts only as a digital trigger press.' }];
const SNAP_AB = { combo: 'A + X/Y + Du/Dd', def: '4', display: 'L + Start' };
const SMOOTH = { combo: 'R + X/Y + Du/Dd', range: '0 to 9', def: '0', display: 'L + Start' };
const CSNAP = { combo: 'AZ + X/Y + Du/Dd', range: '0 to 9', def: '0', display: 'R + Start' };
const WAVE = { combo: 'L + X/Y + Du/Dd', range: '0 to 15', display: 'L + Start' };
const WAVE_C = { combo: 'LZ + X/Y + Du/Dd', range: '0 to 15', display: 'R + Start' };
const OFFSET = { combo: 'RZ + X/Y + Du/Dd', notes: 'Shifts the global C-stick coordinate (for example to help hit downward forward smashes). No numeric range is given. Keep Auto-Initialize off when using an offset.' };
const TRIG = { modeCombo: 'AB + L', valueCombo: 'B + L/R + Du/Dd' };

export const v029 = makeProfile({
  version: 29, tier: 'legacy', cal: L_R_A,
  snap: { ...SNAP_AB, range: '-10 to 10' }, smooth: SMOOTH, wave: WAVE, csnap: CSNAP, waveC: WAVE_C,
  scaling: { combo: 'L + A + Du/Dd', range: '82 to 125', def: '100' },
  cardinal: { combo: 'R + A + Du/Dd', range: '-1 to 6', def: '6' },
  trig: { ...TRIG, modes: 7 }, jump: JUMP_FULL, tourney: { combo: 'Z + Start', notes: 'Cycles modes 1-6 (shown on the C-stick).' },
  rumble: { combo: 'AB + Du/Dd', range: '0 to 11', display: 'AB + Start', oem: '9 is roughly OEM strength; 0 is off' },
  autoInit: { combo: 'AXYZ' },
  notes: ['C-stick offset was removed in 0.29.', 'Version 0.30 was never released (the project skipped it because of many beta builds).',
    'Smart Snapback 4-10 here equals 1-7 on 0.22-0.23.']
});

export const v028 = makeProfile({
  version: 28, tier: 'legacy', cal: L_R_A,
  snap: { ...SNAP_AB, range: '0 to 10' }, smooth: SMOOTH, wave: WAVE, csnap: CSNAP, waveC: WAVE_C, offset: OFFSET,
  trig: { ...TRIG, modes: 7 }, jump: JUMP_FULL,
  rumble: { combo: 'AB + Du/Dd', range: '0 to 11', display: 'AB + Start', oem: '9 is roughly OEM strength; 0 is off' },
  autoInit: { combo: 'AXYZ' },
  notes: ['The guide does not mention a tournament toggle, cardinal snapping or a scaling setting.',
    'The guide text says 6 trigger modes but lists 7.']
});

export const v027 = makeProfile({
  version: 27, tier: 'legacy', cal: L_R_A,
  snap: { ...SNAP_AB, range: '0 to 10' }, smooth: SMOOTH, wave: WAVE, csnap: CSNAP, waveC: WAVE_C, offset: OFFSET,
  trig: { ...TRIG, modes: 7 }, jump: JUMP_FULL,
  rumble: { combo: 'AB + Du/Dd', range: '0 to 7', display: 'AB + Start', oem: '5 is roughly OEM strength; 0 is off' },
  autoInit: { combo: 'AXYZ' },
  notes: ['Rumble range is 0-7 on this version (0-11 from 0.28).', 'Scaling and cardinal snapping are not part of this version.',
    'The guide text says 6 trigger modes but lists 7. Known erratum: trigger mode 7 on the L trigger uses the R trigger offset.']
});

export const v026 = makeProfile({
  version: 26, tier: 'legacy', cal: L_R_A,
  snap: { ...SNAP_AB, range: '0 to 10' }, smooth: SMOOTH, wave: WAVE, csnap: CSNAP, waveC: WAVE_C, offset: OFFSET,
  trig: { ...TRIG, modes: 6 }, jump: JUMP_FULL,
  rumble: { combo: 'AB + Du/Dd', range: '0 to 7', display: 'AB + Start', oem: '5 is roughly OEM strength; 0 is off' },
  autoInit: { combo: 'AXYZ' },
  notes: ['New in 0.26: waveshaping (control stick and C-stick) and trigger jump.', 'Six trigger modes (hairtrigger mode 7 arrived in 0.27).']
});

export const v025 = makeProfile({
  version: 25, tier: 'legacy',
  cal: { advance: 'L or R', adjustNext: 'L or R', advanceKeys: ['L', 'R'], presses: 16, startJumps: true, legacyFlow: true, countUnverified: true },
  snap: { combo: 'L + X/Y + Du/Dd', range: '0 to 10', def: '4', display: 'L + Start + Dd',
    displayText: 'L + Start + Dd shows Smart Snapback on the control stick and axis smoothing on the C-stick.',
    note: 'The guide writes this combo as LX / LY + Du/Dd. Change one axis a step at a time, then re-measure.' },
  smooth: { combo: 'L + A/B + Du/Dd', range: '0 to 9', def: '0', display: 'L + Start + Dd' },
  csnap: { combo: 'R + X/Y + Du/Dd', range: '0 to 9', def: '0', display: 'R + Start + Dd' },
  offset: { combo: 'R + A/B + Du/Dd', unverified: true, notes: 'A = X axis, B = Y axis. Shifts the global C-stick coordinate. No range given. The guide text and its own examples disagree (the examples use L), so check the guide.' },
  trig: { modeCombo: 'ZL + Start', modes: 6, valueCombo: 'Z + L/R + Du/Dd', valueUnverified: true },
  jump: [{ id: 'zjump', name: 'Z-Jump (swap X or Y with Z)', combo: 'XZ + Start', notes: 'YZ + Start swaps Y and Z. Press again to swap back. AXY + Z resets to default.' }],
  rumble: { combo: 'XY + Du/Dd', range: '0 to 7', display: 'BXY', oem: '5 is roughly OEM strength; 0 is off' },
  autoInit: { combo: 'ABLR + Start' },
  notes: ['Calibration in 0.25 asks for the cardinals, then diagonals, then optional extra notches, advanced with L or R only (no A). The press counter is approximate here.',
    'Not covered by this version: waveshaping, trigger jump (only Z-Jump), scaling and cardinal snapping.',
    'The guide describes initial setup as "changed for 0.25" without saying how.']
});

export const OLDER = [v029, v028, v027, v026, v025];
