import fw031 from './fw031.js';
import { OLDER } from './older.js';

// Latest first. Only documented versions are bundled; 0.30 was never released and 0.24 and older are not supported.
export const BUNDLED = [fw031, ...OLDER];

const STEP_KINDS = new Set(['manual', 'rest', 'guide', 'test', 'readVersion']);
const OPS = new Set(['<=', '>=', '<', '>', '==']);

// Returns a list of problems; empty means the profile is usable. Used for imported (user-supplied) profiles.
export function validateProfile(p) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  need(p && typeof p === 'object', 'Profile must be an object');
  if (!p || typeof p !== 'object') return errs;
  need(typeof p.id === 'string' && p.id, 'Missing id');
  need(typeof p.label === 'string' && p.label, 'Missing label');
  need(['current', 'derived', 'legacy', 'custom'].includes(p.tier), 'tier must be current, derived, legacy or custom');
  need(Array.isArray(p.settings), 'settings must be an array');
  need(Array.isArray(p.procedures), 'procedures must be an array');
  need(p.coach && typeof p.coach === 'object', 'coach must be an object');
  need(p.source && typeof p.source.url === 'string', 'source.url is required');
  for (const s of p.settings || []) need(s && s.id && s.name && s.combo, `Setting "${s && (s.id || s.name)}" needs id, name and combo`);
  for (const pr of p.procedures || []) {
    need(pr && pr.id && pr.title && Array.isArray(pr.steps) && pr.steps.length, `Procedure "${pr && pr.id}" needs id, title and steps`);
    for (const st of (pr && pr.steps) || []) {
      need(st.id && STEP_KINDS.has(st.kind), `Step "${st.id}" in ${pr.id} has an unknown kind`);
      if (st.kind === 'test') {
        need(st.test && ['rest', 'rotate', 'release', 'flick', 'free'].includes(st.test.mode), `Test step "${st.id}" needs test.mode`);
        for (const c of (st.test && st.test.checks) || []) need(c.path && OPS.has(c.op) && typeof c.value === 'number', `Check "${c.label}" in ${st.id} is malformed`);
      }
    }
  }
  return errs;
}
