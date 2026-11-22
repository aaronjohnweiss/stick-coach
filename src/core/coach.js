// Rule-based coach. Advice text comes from the selected firmware profile, so combos always match the chosen version.
import { CFG, rnd } from './analysis.js';

export function localCoach(problem, results, profile) {
  const p = (problem || '').toLowerCase();
  const has = re => re.test(p);
  const c = (profile && profile.coach) || {};
  const out = [];
  const R = results || {};
  const seen = Object.keys(R).some(k => R[k] && R[k].enough);

  if (R.rest && R.rest.enough && R.rest.status !== 'ok') {
    const r = R.rest;
    out.push({ t: 'Neutral is off or noisy', b: `At rest the stick averaged (${rnd(r.meanX)}, ${rnd(r.meanY)}) with a max excursion of ${rnd(r.maxR)} (noise σ ${rnd(r.stdX, 2)} / ${rnd(r.stdY, 2)}).${r.maxR > 20 ? ' That is large, so make sure the stick was fully untouched during the test.' : ''} ${c.calib || ''}` });
  }
  if (R.rotation && R.rotation.enough) {
    const r = R.rotation;
    if (r.sDiag !== 'ok') {
      const bad = r.notches.filter(n => !n.missing && n.k % 2 === 1 && Math.abs(n.angErr) > 3).map(n => `${n.name} ${rnd(n.angErr)}°`).join(', ');
      out.push({ t: 'Diagonal notches are off-angle', b: `Worst diagonal error ${rnd(r.maxDiagErr)}° (${bad}). Off-angle diagonals hurt angled inputs like ledgedashes and wavedashes. ${c.calib || ''}` });
    }
    if (r.sAsym !== 'ok') out.push({ t: 'Cardinal reach is uneven', b: `Cardinal radii differ by ${rnd(r.asym)} units. Press firmly into the gate on every cardinal during the test and calibration. ${c.calib || ''} ${c.scale || ''}` });
    if (r.sOff !== 'ok') out.push({ t: 'Cardinals bleed off-axis', b: `Worst cardinal off-axis component is ${rnd(r.maxOff)}. ${c.snapcard || ''} If it persists, recalibrate.` });
    if (r.missing.length) out.push({ t: 'Incomplete rotation', b: `No data near: ${r.missing.join(', ')}. Trace the whole gate again, pressing firmly into every notch.` });
  } else if (R.rotation && !R.rotation.enough) {
    out.push({ t: 'Not enough rotation data', b: 'Trace the full outer gate slowly (at least a couple of laps) for notch analysis.' });
  }
  if (R.releases && R.releases.enough && R.releases.status !== 'ok') {
    const r = R.releases;
    const wd = r.dirs.slice().sort((a, b) => b.worst - a.worst)[0];
    out.push({ t: 'Snapback / release overshoot', b: `Releasing overshoots to the opposite side by up to ${rnd(r.worstOpp)} units (worst direction: ${wd.dir}, ${rnd(wd.worst)}). ${r.worstOpp >= CFG.dz ? 'That exceeds the ~23 deadzone edge, so it can register as a real opposite-direction input (e.g. accidental dashbacks). ' : ''}${c.snap || ''}` });
  }
  if (R.flicks && R.flicks.enough && R.flicks.status !== 'ok') {
    const r = R.flicks;
    out.push({ t: 'Flicks not reaching the smash threshold', b: `${r.reached}/${r.count} flicks reached ${CFG.smash} within 150 ms (median peak ${rnd(r.medPeak)}). Could be technique, a weak gate calibration, or scaling. ${c.scale || ''} ${c.calib || ''}` });
  }

  if (has(/snap|dashback|dash back|ghost|accidental|opposite|release/) && !(R.releases && R.releases.enough)) {
    out.push({ t: 'Test suggestion: Release', b: 'Your description sounds like snapback. Run the "Release (snapback)" test so the overshoot can be measured instead of guessed.' });
  }
  if (has(/notch|diagonal|angle|ledge|wavedash|airdodge|off/) && !(R.rotation && R.rotation.enough)) {
    out.push({ t: 'Test suggestion: Rotate', b: 'Run the "Rotate the gate" test to check diagonal angles and cardinal reach.' });
  }
  if (has(/drift|walk|center|neutral|moves by itself|deadzone/) && !(R.rest && R.rest.enough)) {
    out.push({ t: 'Test suggestion: Rest', b: 'Run the "Rest" test with your hands off the controller to measure drift and noise.' });
  }
  if (has(/smash|tilt|flick|fsmash|upsmash|usmash/) && !(R.flicks && R.flicks.enough)) {
    out.push({ t: 'Test suggestion: Flick', b: 'Run the "Flick to rim" test to see whether flicks reliably cross the smash threshold.' });
  }

  if (!out.length) {
    out.push({ t: seen ? 'No issues found in this recording' : 'No data yet', b: seen ? 'Everything measured is inside the thresholds. If the problem persists, try the other tests or record again while reproducing it.' : 'Run one of the guided tests, then ask again.' });
  }
  if (profile && out.some(o => /\bcalib|snap/i.test(o.b))) out.push({ t: 'Firmware profile in use', b: `Advice above uses the combos for ${profile.label}. Change the firmware profile at the top if your controller runs a different version.` });
  return out;
}
