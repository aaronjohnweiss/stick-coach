// Profile factory for the older documented firmware versions (0.25 - 0.29). Each version file is a small config of
// what differs; this builds the settings table, coach text and walkthroughs from it so they stay consistent.
// Values come from the per-version guides in PhobGCC-doc/For_Users (Phob_Calibration_Guide_v0.NN.md).

export const TARGETS = { snapbackMax: 20, diagErrMax: 3, cardinalSpreadMax: 6, offAxisMax: 4, restOffsetMax: 2 };
const GUIDE_BASE = 'https://github.com/PhobGCC/PhobGCC-doc/blob/main/For_Users/';

const rotateChecks = () => [
  { label: 'Diagonal angle error', path: 'rotation.maxDiagErr', op: '<=', value: TARGETS.diagErrMax },
  { label: 'Cardinal reach spread', path: 'rotation.asym', op: '<=', value: TARGETS.cardinalSpreadMax },
  { label: 'Cardinal off-axis', path: 'rotation.maxOff', op: '<=', value: TARGETS.offAxisMax },
  { label: 'Missing notches', path: 'rotation.missing.length', op: '==', value: 0 }
];
const releaseTest = (id, title, text, stick = 'left') => ({
  id, kind: 'test', title, text,
  test: { mode: 'release', stick, checks: [{ label: 'Worst release overshoot', path: 'releases.worstOpp', op: '<=', value: TARGETS.snapbackMax }] }
});

function detectProcedure(v) {
  const n = String(v).padStart(2, '0');
  return {
    id: 'detect', title: 'Detect firmware version',
    summary: 'Read the version from the C-stick and switch to the matching profile.',
    steps: [{
      id: 'combo', kind: 'readVersion', title: 'Run the version command', combo: 'AZ + Du',
      text: `Hold A and Z, then press D-pad Up. The C-stick shows the version: the Y axis shows the tens and ones digits (${n} for 0.${n}) and the X axis the hundreds and thousands (0). The app watches your buttons and reads the C-stick for you. No response means 0.23 or older, which is not supported here.`,
      note: 'If nothing happens, turn Safe Mode off first (AXY + Start, hold about 1 second) and try again.'
    }]
  };
}

function calibrateProcedure(stick, cal) {
  const isLeft = stick === 'left';
  const name = isLeft ? 'control stick' : 'C-stick';
  const guide = isLeft ? 'C-stick' : 'control stick';
  const adv = cal.advance; // e.g. "L, R or A"
  const measureText = cal.legacyFlow
    ? `Follow the ${guide}: it asks for the four cardinals, then the 45° diagonals, then optional extra notches (one per eighth segment). Hold your stick in the indicated notch, then press ${adv} to advance. If there is no notch at the indicated position, leave your stick centered. Z (while the guide is centered) goes back one step.`
    : `The ${guide} alternates between center and the rim, starting with the cardinals. When it is centered, release your stick and press ${adv}. When it is off-center, hold your stick into the indicated notch (approach it from the direction you use in game) and press ${adv}. No notch there? Release the stick and press ${adv}. Z goes back to the previous measurement. A full calibration takes 32 presses. You must measure all 4 cardinals and all 4 diagonals.`;
  return {
    id: isLeft ? 'calibrate-left' : 'calibrate-c',
    title: isLeft ? 'Calibrate the control stick' : 'Calibrate the C-stick',
    summary: `Measure every notch of the ${name}, then fine-tune the notches. The ${guide} shows which notch to measure.`,
    steps: [
      { id: 'wake', kind: 'manual', title: 'Wake the sticks',
        text: 'After plugging in, press B to activate the sticks (until then they are hardcoded to center). With Dolphin: start Dolphin, plug in the controller, then start the game. Mayflash adapters need both USB connectors plugged in.' },
      { id: 'rest', kind: 'rest', title: 'Leave both sticks untouched', text: `Let go of the ${name}. The app waits for it to be centered and still.` },
      { id: 'configure', kind: 'manual', title: 'Turn Safe Mode off', combo: 'AXY + Start',
        text: 'The controller starts in Safe Mode and changes require turning it off. Hold the combo for about 1 second; the controller freezes for 2 seconds.',
        note: 'Pressing the combo again turns Safe Mode back on with no delay and a 4 second freeze. Unplugging also returns it to Safe Mode.' },
      { id: 'start', kind: 'manual', title: 'Start calibration', combo: isLeft ? 'AXY + L' : 'AXY + R',
        text: `The ${guide} becomes your guide for the ${name}. Calibrating either stick turns off Auto-Initialize.` },
      { id: 'measure', kind: 'guide', guideStick: isLeft ? 'c' : 'left', title: 'Measurement phase',
        presses: cal.presses, advanceKeys: cal.advanceKeys, startJumps: !!cal.startJumps, unverified: !!cal.countUnverified,
        text: measureText + (cal.startJumps ? ' Pressing Start at any point skips straight to notch adjustment.' : ''),
        note: 'The app reads your real button presses from the adapter and also watches the guide stick, so it can show progress and warn if they disagree.' },
      { id: 'adjust', kind: 'manual', title: 'Notch adjustment phase', combo: 'X/Y',
        text: `The ${guide} moves notch to notch, starting with the diagonals; the position of the stick you are calibrating does not matter. X shifts the current notch clockwise and Y counterclockwise (enter the notch from the gameplay direction to see the change). B resets the notch to its measured value. ${cal.adjustNext} moves to the next notch and Z to the previous one; you cannot return to measurement.`,
        note: 'Both phases must be completed or nothing is saved. Calibration saves when the guide returns to center.' },
      { id: 'verify', kind: 'test', title: 'Verify with a gate rotation',
        text: 'Trace the full outer gate slowly, pressing into every notch. The app checks diagonal angles, cardinal reach and off-axis bleed.',
        test: { mode: 'rotate', stick: isLeft ? 'left' : 'c', checks: rotateChecks() } },
      { id: 'safe', kind: 'manual', title: 'Turn Safe Mode back on (optional)', combo: 'AXY + Start',
        text: 'No delay; the controller freezes for 4 seconds. Unplugging and replugging also works.' }
    ]
  };
}

function snapbackProcedure(c) {
  const steps = [
    { id: 'safe', kind: 'manual', title: 'Make sure Safe Mode is off', combo: 'AXY + Start', text: 'Skip this if you already turned Safe Mode off.' },
    releaseTest('baseline', 'Measure current snapback', 'Push the stick to the rim in each direction you care about and let go quickly, about 5 times per direction.'),
    { id: 'view', kind: 'manual', title: 'View the current settings', combo: c.snap.display,
      text: c.snap.displayText || 'Smart Snapback values appear on the control stick (X and Y axes); smoothing appears on the C-stick.' },
    { id: 'adjust', kind: 'manual', title: 'Adjust Smart Snapback', combo: c.snap.combo, unverified: !!c.snap.unverified,
      text: `Hold the buttons, using X for the X axis or Y for the Y axis, then tap D-pad Up to increase or Down to decrease. Range ${c.snap.range}, default ${c.snap.def}. Typical sticks need 4-7; 9 or more is for special cases like metal caps or light springs. Higher values slow the return to center without hurting outward responsiveness; 0 disables the filter and lets snapback return.`,
      note: c.snap.note || 'Change one axis a step at a time, then re-measure.' }
  ];
  if (c.smooth) steps.push({ id: 'smooth', kind: 'manual', title: 'Optional: axis smoothing', combo: c.smooth.combo, unverified: !!c.smooth.unverified,
    text: `A low-pass filter (range ${c.smooth.range}, default ${c.smooth.def}) that slightly reduces responsiveness. For single-motion ledgedashing, about 5 on X and 0 on Y.` });
  steps.push(releaseTest('verify', 'Re-measure', 'Repeat the release test. Go back and adjust if the check still fails.'));
  return { id: 'snapback', title: 'Tune snapback (control stick)', summary: 'Use Smart Snapback until releases overshoot 20 units or less in every direction.', steps };
}

function csnapProcedure(c) {
  return {
    id: 'csnapback', title: 'Tune C-stick snapback', summary: 'Reduce wrong moves and snapback on the C-stick.',
    steps: [
      { id: 'view', kind: 'manual', title: 'View the current settings', combo: c.csnap.display, text: 'C-stick snapback values appear on the control stick.' },
      releaseTest('baseline', 'Measure current snapback', 'Push the C-stick to the rim and let go quickly, several times in each direction.', 'c'),
      { id: 'adjust', kind: 'manual', title: 'Adjust C-stick snapback', combo: c.csnap.combo, unverified: !!c.csnap.unverified,
        text: `Range ${c.csnap.range}, default ${c.csnap.def}. To fully suppress snapback on an axis, start around 7. To reduce wrong moves, raise the unwanted axis and lower the wanted one.` },
      releaseTest('verify', 'Re-measure', 'Repeat the release test.', 'c')
    ]
  };
}

function scalingProcedure(c) {
  const check = { label: 'Cardinal off-axis', path: 'rotation.maxOff', op: '<=', value: TARGETS.offAxisMax };
  return {
    id: 'scaling', title: 'Check scaling and cardinal snapping', summary: 'Adjust the rim value and cardinal behavior of the control stick.',
    steps: [
      { id: 'measure', kind: 'test', title: 'Measure the gate', text: 'Trace the full gate once or twice to see the rim radius and cardinal behavior.', test: { mode: 'rotate', stick: 'left', checks: [check] } },
      { id: 'scale', kind: 'manual', title: 'Adjust scaling if needed', combo: c.scaling.combo,
        text: `Range ${c.scaling.range}, default ${c.scaling.def}. Changes the physical distance to the Melee rim: lower values need larger motions, higher values smaller ones. 100 matches older firmware behavior. For the C-stick add Z to the combo.` },
      { id: 'cardinal', kind: 'manual', title: 'Adjust cardinal snapping if needed', combo: c.cardinal.combo,
        text: `Range ${c.cardinal.range}, default ${c.cardinal.def}. The width of the window that snaps to 1.0 cardinals: -1 snaps away so no 1.0 cardinals are possible, 0 is OEM-like, 1-6 snaps from that distance in both directions. Mainly for vanilla Melee or UCF 0.80 and earlier; UCF 0.84 overrides non-negative values with its own snapping.` },
      { id: 'verify', kind: 'test', title: 'Re-measure the gate', text: 'Trace the gate again to confirm.', test: { mode: 'rotate', stick: 'left', checks: [check] } }
    ]
  };
}

function resetProcedure(c) {
  return {
    id: 'reset', title: 'Reset settings', summary: 'Restore snapback, waveshaping, offsets and remaps to defaults. Calibration is kept.',
    steps: [
      { id: 'safe', kind: 'manual', title: 'Turn Safe Mode off', combo: 'AXY + Start', text: 'Reset only works with Safe Mode off.' },
      { id: 'reset', kind: 'manual', title: 'Reset', combo: 'ABZ', text: 'Hold A, B and Z, then press Start. Everything except stick calibration is reset (snapback, waveshaping, analog delay, offsets, button remapping), and Auto-Initialize returns to its default.',
        note: 'A hidden hard reset that also erases calibration exists but its combo is not published.' }
    ]
  };
}

export function makeProfile(c) {
  const n = String(c.version).padStart(2, '0');
  const settings = [
    { id: 'configure', name: 'Safe Mode toggle', combo: 'AXY + Start', notes: 'Hold about 1 s to turn Safe Mode off (freezes 2 s). Press again to turn it on (no delay, freezes 4 s).' },
    { id: 'version', name: 'Version check', combo: 'AZ + Du', display: `C-stick Y shows tens and ones (${n}); X shows hundreds and thousands (0).`, notes: 'No response suggests 0.23 or older.' },
    { id: 'calL', name: 'Calibrate control stick', combo: 'AXY + L', notes: `${c.cal.advance} advances; Z goes back.` },
    { id: 'calC', name: 'Calibrate C-stick', combo: 'AXY + R' },
    { id: 'smart', name: 'Smart Snapback (control stick)', combo: c.snap.combo, range: c.snap.range, def: c.snap.def, display: c.snap.display, unverified: !!c.snap.unverified, notes: c.snap.noteRef },
    c.smooth && { id: 'smooth', name: 'Axis smoothing (control stick)', combo: c.smooth.combo, range: c.smooth.range, def: c.smooth.def, display: c.smooth.display, unverified: !!c.smooth.unverified },
    c.wave && { id: 'waveL', name: 'Waveshaping (control stick)', combo: c.wave.combo, range: c.wave.range, def: '0', display: c.wave.display },
    c.csnap && { id: 'csnap', name: 'C-stick snapback', combo: c.csnap.combo, range: c.csnap.range, def: c.csnap.def, display: c.csnap.display, unverified: !!c.csnap.unverified },
    c.waveC && { id: 'waveC', name: 'Waveshaping (C-stick)', combo: c.waveC.combo, range: c.waveC.range, def: '0', display: c.waveC.display },
    c.offset && { id: 'offset', name: 'C-stick offset', combo: c.offset.combo, notes: c.offset.notes, unverified: !!c.offset.unverified },
    c.scaling && { id: 'scaleL', name: 'Scaling (control stick)', combo: c.scaling.combo, range: c.scaling.range, def: c.scaling.def },
    c.scaling && { id: 'scaleC', name: 'Scaling (C-stick)', combo: 'L + A + Z + Du/Dd', range: c.scaling.range, def: c.scaling.def },
    c.cardinal && { id: 'cardL', name: 'Cardinal snapping (control stick)', combo: c.cardinal.combo, range: c.cardinal.range, def: c.cardinal.def },
    c.cardinal && { id: 'cardC', name: 'Cardinal snapping (C-stick)', combo: 'R + A + Z + Du/Dd', range: c.cardinal.range, def: c.cardinal.def },
    { id: 'trigMode', name: `Trigger mode (${c.trig.modes} modes)`, combo: c.trig.modeCombo, notes: `${c.trig.modeCombo.replace('L', 'R')} for the right trigger. Mode 5 is incompatible with modes 1, 3 and 4 on the other trigger.`, unverified: !!c.trig.unverified },
    { id: 'trigVal', name: 'Trigger value (modes 4-6; mode 7 scaling if present)', combo: c.trig.valueCombo, range: '49 to 227', unverified: !!c.trig.valueUnverified },
    ...c.jump,
    c.tourney && { id: 'tourney', name: 'Tournament toggle', combo: c.tourney.combo, notes: c.tourney.notes },
    { id: 'rumble', name: 'Rumble', combo: c.rumble.combo, range: c.rumble.range, display: c.rumble.display, notes: `${c.rumble.oem}. Board version 1.2 or later.` },
    { id: 'autoInit', name: 'Auto-Initialize', combo: c.autoInit.combo, notes: 'On: both sticks point up-right; off: down-left. Turns off after recalibration or reset.' },
    { id: 'reset', name: 'Reset settings', combo: 'ABZ', notes: 'Hold ABZ, then press Start (Safe Mode off). Keeps stick calibration.' }
  ].filter(Boolean);

  const procedures = [detectProcedure(c.version), calibrateProcedure('left', c.cal), calibrateProcedure('c', c.cal), snapbackProcedure(c)];
  if (c.csnap) procedures.push(csnapProcedure(c));
  if (c.scaling && c.cardinal) procedures.push(scalingProcedure(c));
  procedures.push(resetProcedure(c));

  return {
    id: `0.${n}`,
    label: `Firmware 0.${n}${c.tier === 'legacy' ? ' (legacy)' : ''}`,
    tier: c.tier || 'legacy',
    confidence: 'official',
    versionNumbers: [c.version],
    source: { label: `PhobGCC Calibration Guide v0.${n}`, url: `${GUIDE_BASE}Phob_Calibration_Guide_v0.${n}.md` },
    notes: [
      'This is a legacy firmware version; the latest guide recommends updating.',
      ...(c.notes || [])
    ],
    targets: TARGETS,
    coach: {
      calib: `Recalibrate: turn Safe Mode off (AXY + Start, hold about 1 s), then AXY + L for the control stick or AXY + R for the C-stick. Follow the guide stick; ${c.cal.advance} advances, Z goes back${c.cal.startJumps ? ', Start skips to notch adjustment' : ''}. Both phases must finish or nothing is saved. Use the Guided Setup tab for the full walkthrough.`,
      snap: `Raise Smart Snapback with ${c.snap.combo} (range ${c.snap.range}, default ${c.snap.def}; typical 4-7). View current values with ${c.snap.display}. Aim for 20 or less in each direction.`,
      scale: c.scaling ? `Scaling is ${c.scaling.combo} (range ${c.scaling.range}, default ${c.scaling.def}).` : 'This firmware version has no scaling setting; recalibrate carefully instead, or update the firmware.',
      snapcard: c.cardinal ? `Cardinal snapping is ${c.cardinal.combo} (range ${c.cardinal.range}, default ${c.cardinal.def}).` : 'This firmware version has no cardinal snapping setting; update the firmware to use it.',
      reset: 'Reset (hold ABZ, then press Start, with Safe Mode off) restores everything except stick calibration.'
    },
    settings,
    procedures
  };
}
