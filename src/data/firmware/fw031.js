// Firmware 0.31: transcribed from the official guide
// https://github.com/PhobGCC/PhobGCC-doc/blob/main/For_Users/Phob_Calibration_Guide_Latest.md
// Combos use physical buttons. "Du/Dd" = D-pad up/down. Update this file when the guide changes.

const T = { snapbackMax: 20, diagErrMax: 3, cardinalSpreadMax: 6, offAxisMax: 4, restOffsetMax: 2 };

function calibrate(stick) {
  const isLeft = stick === 'left';
  const name = isLeft ? 'control stick' : 'C-stick';
  const guide = isLeft ? 'C-stick' : 'control stick';
  return {
    id: isLeft ? 'calibrate-left' : 'calibrate-c',
    title: isLeft ? 'Calibrate the control stick' : 'Calibrate the C-stick',
    summary: `Measure every notch of the ${name}, then fine-tune the notches. The ${guide} acts as an on-screen guide.`,
    steps: [
      {
        id: 'wake', kind: 'manual', title: 'Wake the sticks',
        text: 'Press B once after plugging in the controller so the sticks start reporting. (Mayflash adapters need both USB connectors plugged in.)'
      },
      {
        id: 'rest', kind: 'rest', title: 'Leave both sticks untouched',
        text: `Let go of the ${name}. The app waits for the stick to be centered and still.`
      },
      {
        id: 'configure', kind: 'manual', title: 'Enter Configure Mode', combo: 'AXY + Start',
        text: 'Hold the combo for about 1 second. The controller freezes for 2 seconds. Safe Mode (the default) only allows the toggle, so this is required before calibrating.',
        note: 'Press the same combo again later to return to Safe Mode.'
      },
      {
        id: 'start', kind: 'manual', title: 'Start calibration', combo: isLeft ? 'AXY + L' : 'AXY + R',
        text: `The controller freezes briefly to confirm, then the ${guide} becomes your on-screen guide for the ${name}.`
      },
      {
        id: 'measure', kind: 'guide', guideStick: isLeft ? 'c' : 'left', title: 'Measurement phase',
        text: `Follow the ${guide}. When it is centered, release your stick and press L, R or A. When it points into a notch, hold your stick in that notch (enter it from the direction you use in game) and press L, R or A. If there is no notch at that position, release the stick and press. Z goes back one measurement. All 32 presses are needed.`,
        note: 'The app counts guide movements to show progress. It cannot see which button you pressed, so treat the counter as a guide.'
      },
      {
        id: 'adjust', kind: 'manual', title: 'Notch adjustment phase',
        text: 'The guide now moves notch to notch, starting with the diagonals. Press X (clockwise) or Y (counterclockwise) to shift the current notch, and enter the notch to see the change. B resets the notch to its measured position. L, R or A moves on, Z goes back.',
        combo: 'X/Y',
        note: 'Both phases must be completed or nothing is saved. Calibration saves when the guide returns to center. If you only want to adjust notches on an already-calibrated stick, press Start during the measurement phase to jump straight to adjustment.'
      },
      {
        id: 'verify', kind: 'test', title: 'Verify with a gate rotation',
        text: 'Trace the full outer gate slowly, pressing into every notch. The app checks diagonal angles, cardinal reach and off-axis bleed.',
        test: {
          mode: 'rotate', stick: isLeft ? 'left' : 'c',
          checks: [
            { label: 'Diagonal angle error', path: 'rotation.maxDiagErr', op: '<=', value: T.diagErrMax },
            { label: 'Cardinal reach spread', path: 'rotation.asym', op: '<=', value: T.cardinalSpreadMax },
            { label: 'Cardinal off-axis', path: 'rotation.maxOff', op: '<=', value: T.offAxisMax },
            { label: 'Missing notches', path: 'rotation.missing.length', op: '==', value: 0 }
          ]
        }
      },
      {
        id: 'safe', kind: 'manual', title: 'Return to Safe Mode (optional)', combo: 'AXY + Start',
        text: 'Press the combo again (no delay), or unplug and replug. The controller freezes for 4 seconds.'
      }
    ]
  };
}

export default {
  id: '0.31',
  label: 'Firmware 0.31 (latest)',
  tier: 'current',
  confidence: 'official',
  versionNumbers: [31],
  source: {
    label: 'PhobGCC Calibration Guide (Latest)',
    url: 'https://github.com/PhobGCC/PhobGCC-doc/blob/main/For_Users/Phob_Calibration_Guide_Latest.md'
  },
  notes: [
    'Safe Mode is the default; only the toggle works until you enter Configure Mode (AXY + Start, hold ~1 s).',
    'Command display timing: binary commands hold the stick display for 2 s, numeric values 0.75 s, trigger offsets 0.1 s.',
    'All commands use the physical buttons regardless of remapping.',
    'Hidden hard reset (also erases calibration) is not published; the guide points to the PhobGCC Discord.'
  ],
  targets: T,
  coach: {
    calib: 'Recalibrate: enter Configure Mode (AXY + Start), then AXY + L for the control stick (AXY + R for the C-stick). Follow the guide stick through all measurements, then the notch-adjustment phase; both phases must finish or nothing is saved. Use the Guided Setup tab for the full walkthrough.',
    snap: 'Raise Smart Snapback with A + X/Y + Du/Dd (range -10 to 10, default 4; typical sticks 4-7, 9+ only for special cases). View current values with L + Start. Aim for 20 or less in each direction. If max filtering is not enough, thick silicone grease in the stickbox can help.',
    scale: 'Check Scaling (L + A + Du/Dd, range 90-110, default 100; C-stick adds Z). It sets the stick value at the gate rim relative to the Melee unit circle.',
    snapcard: 'Cardinal snapping (R + A + Du/Dd, range -2 to 6, default 6) pulls near-cardinal inputs onto the axis; 0 is OEM behavior. UCF 0.84 overrides non-negative values with its own snapping.',
    reset: 'Reset (hold ABZ, then press Start, with Safe Mode off) restores everything except stick calibration: snapback, waveshaping, offsets and remaps.'
  },
  settings: [
    { id: 'configure', name: 'Configure Mode toggle', combo: 'AXY + Start', notes: 'Hold ~1 s; freezes 2 s. Press again to return to Safe Mode (freezes 4 s).' },
    { id: 'version', name: 'Version check', combo: 'AZ + Du', display: 'C-stick shows the version in raw units (31); the older guides put the tens and ones on the Y axis.', notes: '0.23 or lower gives no response.' },
    { id: 'rawOut', name: 'Raw stick output check', combo: 'LR + Du', notes: 'Disable with LR + Dd. Centered values: ~50 on Phob 2s, ~30 on Phob 1.1s and most 1.2s.' },
    { id: 'calL', name: 'Calibrate control stick', combo: 'AXY + L' },
    { id: 'calC', name: 'Calibrate C-stick', combo: 'AXY + R' },
    { id: 'smart', name: 'Smart Snapback (control stick)', combo: 'A + X/Y + Du/Dd', range: '-10 to 10', def: '4', display: 'L + Start (on the control stick)' },
    { id: 'smooth', name: 'Axis smoothing (control stick)', combo: 'R + X/Y + Du/Dd', range: '0 to 18', def: '0', display: 'L + Start (on the C-stick)' },
    { id: 'csnap', name: 'C-stick snapback', combo: 'AZ + X/Y + Du/Dd', range: '0 to 18', def: '0', display: 'R + Start (on the control stick)' },
    { id: 'waveL', name: 'Waveshaping (control stick)', combo: 'L + X/Y + Du/Dd', range: '-24 to 24', def: '0', display: 'L + Start (on the triggers)' },
    { id: 'waveC', name: 'Waveshaping (C-stick)', combo: 'LZ + X/Y + Du/Dd', range: '-24 to 24', def: '0', display: 'R + Start' },
    { id: 'scaleL', name: 'Scaling (control stick)', combo: 'L + A + Du/Dd', range: '90 to 110', def: '100' },
    { id: 'scaleC', name: 'Scaling (C-stick)', combo: 'L + A + Z + Du/Dd', range: '90 to 110', def: '100' },
    { id: 'cardL', name: 'Cardinal snapping (control stick)', combo: 'R + A + Du/Dd', range: '-2 to 6', def: '6' },
    { id: 'cardC', name: 'Cardinal snapping (C-stick)', combo: 'R + A + Z + Du/Dd', range: '-1 to 6', def: '6' },
    { id: 'trigMode', name: 'Trigger mode (left / right)', combo: 'AB + L', notes: 'AB + R for the right trigger. Cycles 9 modes.' },
    { id: 'trigVal', name: 'Trigger value', combo: 'B + L/R + Du/Dd', range: '49 to 227' },
    { id: 'trigView', name: 'View trigger settings', combo: 'L + R + Z' },
    { id: 'hwCheck', name: 'Trigger hardware check', combo: 'L + R + A + Start', notes: 'Outputs full analog and digital on the triggers.' },
    { id: 'remap', name: 'Button remapping', combo: 'B + X + Y', notes: 'Then press A, B, Du, L, R, X, Y, Z in that order for the buttons you want assigned. Reset with B + X + R.' },
    { id: 'tourney', name: 'Tournament toggle', combo: 'Z + Start + Du', notes: 'Cycles modes 1-6.' },
    { id: 'rumble', name: 'Rumble', combo: 'AB + Du/Dd', range: '0 to 11', display: 'AB + Start', notes: 'Board version 1.2 or later. 9 roughly matches OEM.' },
    { id: 'autoInit', name: 'Auto-Initialize', combo: 'AXYZ', notes: 'Skips the B press once calibration is reliable; turns off after recalibration or reset.' },
    { id: 'reset', name: 'Reset settings', combo: 'ABZ', notes: 'Hold ABZ, then press Start (Safe Mode off). Keeps stick calibration.' }
  ],
  procedures: [
    {
      id: 'detect', title: 'Detect firmware version',
      summary: 'Read the version from the C-stick and switch to the matching profile.',
      steps: [
        { id: 'combo', kind: 'readVersion', title: 'Run the version command', combo: 'AZ + Du',
          text: 'Hold the combo. The controller freezes briefly and the C-stick shows the firmware version in raw units (31 means 0.31; older guides put the tens and ones digits on the Y axis). The app watches your buttons and reads the C-stick for you.' }
      ]
    },
    calibrate('left'),
    calibrate('c'),
    {
      id: 'snapback', title: 'Tune snapback (control stick)',
      summary: 'Use Smart Snapback until releases overshoot 20 units or less in every direction.',
      steps: [
        { id: 'configure', kind: 'manual', title: 'Make sure Configure Mode is on', combo: 'AXY + Start',
          text: 'Skip this if you are already in Configure Mode.' },
        { id: 'baseline', kind: 'test', title: 'Measure current snapback',
          text: 'Push the stick to the rim in each direction you care about and let go quickly. Do about 5 releases per direction.',
          test: { mode: 'release', stick: 'left', checks: [{ label: 'Worst release overshoot', path: 'releases.worstOpp', op: '<=', value: T.snapbackMax }] } },
        { id: 'view', kind: 'manual', title: 'View the current setting', combo: 'L + Start',
          text: 'Smart Snapback values appear on the control stick (X and Y axes).' },
        { id: 'adjust', kind: 'manual', title: 'Adjust Smart Snapback', combo: 'A + X/Y + Du/Dd',
          text: 'Hold A and X (X axis) or Y (Y axis), then tap D-pad Up to increase or Down to decrease. Range -10 to 10, default 4. Typical sticks land at 4-7; 9 or more is for special cases like metal caps or light springs. Higher values slow the return to center without hurting outward responsiveness. 0 disables the filter.',
          note: 'Change one axis a step at a time, then re-measure. If you cannot get under 20 at maximum filtering, thick silicone grease in the stickbox can help.' },
        { id: 'smooth', kind: 'manual', title: 'Optional: axis smoothing', combo: 'R + X/Y + Du/Dd',
          text: 'A simple low-pass filter (0-18, default 0). Higher values slightly reduce responsiveness. Useful when Smart Snapback is off; about 5 on X and 0 on Y is a reference for single-motion ledgedash.' },
        { id: 'verify', kind: 'test', title: 'Re-measure',
          text: 'Repeat the release test. Go back and adjust if the check still fails.',
          test: { mode: 'release', stick: 'left', checks: [{ label: 'Worst release overshoot', path: 'releases.worstOpp', op: '<=', value: T.snapbackMax }] } }
      ]
    },
    {
      id: 'csnapback', title: 'Tune C-stick snapback',
      summary: 'Reduce wrong moves and snapback on the C-stick.',
      steps: [
        { id: 'view', kind: 'manual', title: 'View the current setting', combo: 'R + Start', text: 'C-stick snapback values appear on the control stick.' },
        { id: 'baseline', kind: 'test', title: 'Measure current snapback',
          text: 'Push the C-stick to the rim and let go quickly, several times in each direction.',
          test: { mode: 'release', stick: 'c', checks: [{ label: 'Worst release overshoot', path: 'releases.worstOpp', op: '<=', value: T.snapbackMax }] } },
        { id: 'adjust', kind: 'manual', title: 'Adjust C-stick snapback', combo: 'AZ + X/Y + Du/Dd',
          text: 'Range 0-18, default 0. To fully suppress snapback, start around 7. To avoid wrong moves, raise the unwanted axis and lower the wanted one.' },
        { id: 'verify', kind: 'test', title: 'Re-measure',
          text: 'Repeat the release test.',
          test: { mode: 'release', stick: 'c', checks: [{ label: 'Worst release overshoot', path: 'releases.worstOpp', op: '<=', value: T.snapbackMax }] } }
      ]
    },
    {
      id: 'scaling', title: 'Check scaling and cardinal snapping',
      summary: 'Adjust the rim value and cardinal behavior of the control stick.',
      steps: [
        { id: 'measure', kind: 'test', title: 'Measure the gate', text: 'Trace the full gate once or twice to see the current rim radius and cardinal behavior.',
          test: { mode: 'rotate', stick: 'left', checks: [{ label: 'Cardinal off-axis', path: 'rotation.maxOff', op: '<=', value: T.offAxisMax }] } },
        { id: 'scale', kind: 'manual', title: 'Adjust scaling if needed', combo: 'L + A + Du/Dd',
          text: 'Range 90-110, default 100. Adjusts the stick value at the gate rim relative to the Melee unit circle (100 matches firmware without scaling). For the C-stick add Z to the combo.' },
        { id: 'cardinal', kind: 'manual', title: 'Adjust cardinal snapping if needed', combo: 'R + A + Du/Dd',
          text: 'Range -2 to 6, default 6. 0 is OEM behavior (no snapping); -1 and -2 keep the stick away from 1.0 cardinals. UCF 0.84 overrides non-negative values with its own snapping.' },
        { id: 'verify', kind: 'test', title: 'Re-measure the gate', text: 'Trace the gate again to confirm.',
          test: { mode: 'rotate', stick: 'left', checks: [{ label: 'Cardinal off-axis', path: 'rotation.maxOff', op: '<=', value: T.offAxisMax }] } }
      ]
    },
    {
      id: 'reset', title: 'Reset settings',
      summary: 'Restore snapback, waveshaping, offsets and remaps to defaults. Calibration is kept.',
      steps: [
        { id: 'configure', kind: 'manual', title: 'Turn Safe Mode off', combo: 'AXY + Start', text: 'Reset only works outside Safe Mode.' },
        { id: 'reset', kind: 'manual', title: 'Reset', combo: 'ABZ',
          text: 'Hold ABZ, then press Start. Everything except stick calibration is reset, and Auto-Initialize returns to its default.',
          note: 'A hidden hard reset that also erases calibration exists but is not published; the guide directs you to the PhobGCC Discord.' }
      ]
    }
  ]
};
