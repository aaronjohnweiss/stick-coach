import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from '../scripts/make-latest-json.mjs';

const read = f => ({ 'A.AppImage.sig': ' sigL \n', 'S-setup.exe.sig': 'sigW' })[f];
const base = { read, version: '0.2.7', tag: 'v0.2.7', repo: 'o/r', now: new Date('2026-01-02T03:04:05Z') };

test('manifest lists each signed platform with its signature and download url', () => {
  const m = buildManifest({ ...base, files: ['A.AppImage', 'A.AppImage.sig', 'S-setup.exe', 'S-setup.exe.sig', 'x.deb'] });
  assert.deepEqual(m, {
    version: '0.2.7', notes: '', pub_date: '2026-01-02T03:04:05.000Z',
    platforms: {
      'linux-x86_64': { signature: 'sigL', url: 'https://github.com/o/r/releases/download/v0.2.7/A.AppImage' },
      'windows-x86_64': { signature: 'sigW', url: 'https://github.com/o/r/releases/download/v0.2.7/S-setup.exe' }
    }
  });
});

test('a bundle without a signature is left out, and no signed bundle at all is an error', () => {
  const m = buildManifest({ ...base, files: ['A.AppImage', 'A.AppImage.sig', 'S-setup.exe'] });
  assert.deepEqual(Object.keys(m.platforms), ['linux-x86_64']);
  assert.throws(() => buildManifest({ ...base, files: ['A.AppImage', 'x.deb'] }), /No signed bundles/);
});
