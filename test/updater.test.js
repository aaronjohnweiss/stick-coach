import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, installUpdate, updaterAvailable } from '../src/core/updater.js';

test('updater is a no-op without the Tauri plugin', async () => {
  assert.equal(updaterAvailable(undefined), false);
  assert.equal(updaterAvailable({ core: {} }), false);
  assert.equal(await checkForUpdate(undefined), null);
});

test('checkForUpdate returns the update, null when current, and rejects when the check fails', async () => {
  const update = { version: '0.2.9' };
  assert.equal(await checkForUpdate({ updater: { check: async () => update } }), update);
  assert.equal(await checkForUpdate({ updater: { check: async () => null } }), null);
  await assert.rejects(checkForUpdate({ updater: { check: async () => { throw new Error('offline'); } } }), /offline/);
});

test('installUpdate reports progress, then restarts', async () => {
  const log = [], steps = [];
  const update = { downloadAndInstall: async cb => { cb({ event: 'Started', data: { contentLength: 200 } }); cb({ event: 'Progress', data: { chunkLength: 50 } }); cb({ event: 'Progress', data: { chunkLength: 150 } }); cb({ event: 'Finished' }); } };
  await installUpdate({ process: { relaunch: async () => { steps.push('relaunch'); } } }, update, m => log.push(m));
  assert.deepEqual(log, ['Downloading update...', 'Downloading update... 25%', 'Downloading update... 100%', 'Installing update...', 'Restarting...']);
  assert.deepEqual(steps, ['relaunch']);
});

test('installUpdate does not restart when the install fails', async () => {
  let relaunched = false;
  const update = { downloadAndInstall: async () => { throw new Error('not an AppImage'); } };
  await assert.rejects(installUpdate({ process: { relaunch: async () => { relaunched = true; } } }, update), /not an AppImage/);
  assert.equal(relaunched, false);
});
