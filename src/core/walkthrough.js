// Walkthrough runner: step navigation + automatic readiness checks. UI-agnostic so it can be unit tested.
import { evalChecks } from './analysis.js';

export class Runner {
  constructor(profile, procedure) {
    this.profile = profile;
    this.proc = procedure;
    this.idx = 0;
    this.done = new Set();
    this.checks = {};
    this.finished = false;
  }
  get step() { return this.proc.steps[this.idx]; }
  get total() { return this.proc.steps.length; }
  get progress() { return { index: this.idx, total: this.total, fraction: (this.finished ? this.total : this.idx) / this.total }; }
  next() {
    this.done.add(this.step.id);
    if (this.idx < this.total - 1) { this.idx++; return true; }
    this.finished = true;
    return false;
  }
  prev() { if (this.idx > 0) { this.idx--; this.finished = false; } }
  goto(i) { if (i >= 0 && i < this.total) { this.idx = i; this.finished = false; } }
  // Evaluate the current test step against analysis results.
  evaluate(results) {
    const s = this.step;
    if (s.kind !== 'test') return null;
    const checks = evalChecks(s.test.checks, results);
    this.checks[s.id] = checks;
    return { checks, pass: checks.every(c => c.pass) };
  }
}

// ctx: {restMs, guide:{presses,total,phase}, versionMatch, testPass}
export function stepAuto(step, ctx) {
  switch (step.kind) {
    case 'rest':
      return ctx.restMs >= 500
        ? { ready: true, message: 'Stick is centered and still.' }
        : { ready: false, message: 'Waiting for the stick to be centered and still...' };
    case 'guide': {
      const g = ctx.guide || { presses: 0, total: 32, phase: 'measure' };
      return g.phase === 'adjust'
        ? { ready: true, message: 'Measurement phase complete.' }
        : { ready: false, message: `Presses counted: ${g.presses} of ${g.total}.` };
    }
    case 'readVersion':
      return ctx.versionMatch && ctx.versionMatch.profile
        ? { ready: true, message: `Reading ${ctx.versionMatch.value}: ${ctx.versionMatch.profile.label}.` }
        : { ready: false, message: ctx.versionMatch ? ctx.versionMatch.note : 'Hold the combo and watch the C-stick X reading.' };
    case 'test':
      return ctx.testPass === true
        ? { ready: true, message: 'All checks passed.' }
        : { ready: false, message: ctx.testPass === false ? 'Some checks failed. Adjust and run the test again, or continue anyway.' : 'Run the test to continue.' };
    default:
      return { ready: true, message: '' };
  }
}
