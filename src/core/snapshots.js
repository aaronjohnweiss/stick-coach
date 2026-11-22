// Snapshots: a saved record of how a stick was tuned and how it measured at that moment.
// Pure data helpers (no DOM, no storage); see snapshotstore.js for persistence.
import { DIRS, summarizeNotches, metricsOf, rnd as round } from './analysis.js';

const rnd = (v, n) => round(v, n) + 0; // + 0 turns -0 into 0 so stored numbers survive a JSON round trip unchanged

export const SNAPSHOT_VERSION = 1;
export const STORE_VERSION = 1;
// Test mode -> key of the analysis block / measurement it produces.
export const BLOCK_OF = { rest: 'rest', rotate: 'rotation', release: 'releases', flick: 'flicks' };
export const MODES = Object.keys(BLOCK_OF);

export function newId() {
  const c = globalThis.crypto;
  return c && c.randomUUID ? c.randomUUID() : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// The numeric settings of a firmware profile (the ones with a range), prefilled with their defaults.
export function settingsSheet(profile) {
  return ((profile && profile.settings) || []).filter(s => s.range).map(s => ({
    id: s.id, name: s.name, combo: s.combo, range: s.range, value: s.def === undefined ? '' : String(s.def)
  }));
}

// Compact, storable form of one test's analysis (drops the per-event arrays). Null if there was not enough data.
export function compactBlock(mode, results) {
  const r = results && results[BLOCK_OF[mode]];
  if (!r || !r.enough) return null;
  switch (mode) {
    case 'rest': return { meanX: rnd(r.meanX, 2), meanY: rnd(r.meanY, 2), offset: rnd(r.offset, 2), stdX: rnd(r.stdX, 2), stdY: rnd(r.stdY, 2), maxR: rnd(r.maxR, 2) };
    case 'rotate': return {
      maxR: rnd(r.maxR, 1),
      notches: r.notches.map(n => (n.missing ? { k: n.k, name: n.name, missing: true } :
        { k: n.k, name: n.name, x: rnd(n.x, 2), y: rnd(n.y, 2), r: rnd(n.r, 2), angle: rnd(n.angle, 2), angErr: rnd(n.angErr, 2) }))
    };
    case 'release': return { count: r.count, worstOpp: rnd(r.worstOpp, 2), meanOpp: rnd(r.meanOpp, 2), dirs: r.dirs.map(d => ({ dir: d.dir, n: d.n, worst: rnd(d.worst, 2), mean: rnd(d.mean, 2) })) };
    case 'flick': return { count: r.count, reached: r.reached, frac: rnd(r.frac, 3), medPeak: rnd(r.medPeak, 1) };
    default: return null;
  }
}

// Analysis-shaped results for a snapshot, with its N/A notches excluded from the rotation statistics.
export function snapshotResults(snap) {
  const m = snap.measurements || {};
  const out = {};
  if (m.rest) out.rest = { enough: true, ...m.rest };
  if (m.rotation) out.rotation = { enough: true, maxR: m.rotation.maxR, notches: m.rotation.notches, ...summarizeNotches(m.rotation.notches, snap.naNotches) };
  if (m.releases) out.releases = { enough: true, ...m.releases };
  if (m.flicks) out.flicks = { enough: true, ...m.flicks };
  return out;
}
export const snapshotMetrics = snap => metricsOf(snapshotResults(snap));

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

export function createSnapshot(o) {
  const stick = o.stick === 'c' ? 'c' : 'left';
  const measurements = {};
  for (const key of Object.values(BLOCK_OF)) if (o.measurements && o.measurements[key]) measurements[key] = o.measurements[key];
  return {
    v: SNAPSHOT_VERSION,
    id: o.id || newId(),
    createdAt: o.createdAt || Date.now(),
    name: String(o.name || '').trim() || 'Untitled snapshot',
    description: String(o.description || ''),
    rating: clampInt(o.rating, 0, 5), // 0 = unrated
    fw: String(o.fw || ''),
    stick,
    origin: o.origin || null, // adapter origin when captured, e.g. {lx:127,...}; used to flag adapter changes in drift checks
    naNotches: [...new Set((o.naNotches || []).map(Number).filter(k => Number.isInteger(k) && k >= 0 && k < DIRS.length))].sort((a, b) => a - b),
    settings: (o.settings || []).map(s => ({ id: String(s.id), name: String(s.name || s.id), combo: s.combo || '', range: s.range || '', value: String(s.value === undefined ? '' : s.value) })),
    measurements
  };
}

export function validateSnapshot(s) {
  const errs = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  if (typeof s.id !== 'string' || !s.id) errs.push('missing id');
  if (typeof s.name !== 'string') errs.push('missing name');
  if (!Number.isFinite(s.createdAt)) errs.push('bad timestamp');
  if (!Number.isInteger(s.rating) || s.rating < 0 || s.rating > 5) errs.push('bad rating');
  if (s.stick !== 'left' && s.stick !== 'c') errs.push('bad stick');
  if (!Array.isArray(s.naNotches) || !s.naNotches.every(k => Number.isInteger(k) && k >= 0 && k < DIRS.length)) errs.push('bad naNotches');
  if (!Array.isArray(s.settings)) errs.push('bad settings');
  if (!s.measurements || typeof s.measurements !== 'object') errs.push('bad measurements');
  return errs;
}

// Bring an older snapshot up to the current shape. Only version 1 exists so far; unknown future versions are kept as-is.
export function migrateSnapshot(s) { return s; }

export function serializeStore(list) { return JSON.stringify({ version: STORE_VERSION, snapshots: list }, null, 1); }

// Parse a store file. Bad entries are skipped and reported rather than failing the whole file.
export function parseStore(text) {
  if (text === null || text === undefined || text === '') return { snapshots: [], errors: [] };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { snapshots: [], errors: ['Snapshot file is not valid JSON: ' + e.message] }; }
  const raw = Array.isArray(data) ? data : data && Array.isArray(data.snapshots) ? data.snapshots : null;
  if (!raw) return { snapshots: [], errors: ['Snapshot file has no "snapshots" list.'] };
  const snapshots = [], errors = [];
  raw.forEach((s, i) => {
    const m = migrateSnapshot(s);
    const bad = validateSnapshot(m);
    if (bad.length) errors.push(`Skipped snapshot #${i + 1}${s && s.name ? ' "' + s.name + '"' : ''}: ${bad.join(', ')}.`);
    else snapshots.push(m);
  });
  return { snapshots, errors };
}

// Merge snapshots from an exported file into the current list. Identical ones are skipped; a clashing id gets a new id.
export function mergeImported(list, text) {
  const { snapshots, errors } = parseStore(text);
  const out = list.slice();
  let added = 0, skipped = 0;
  for (const s of snapshots) {
    const same = out.find(x => x.id === s.id);
    if (same && JSON.stringify(same) === JSON.stringify(s)) { skipped++; continue; }
    out.unshift(same ? { ...s, id: newId() } : s);
    added++;
  }
  return { list: out, added, skipped, errors };
}

export const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
