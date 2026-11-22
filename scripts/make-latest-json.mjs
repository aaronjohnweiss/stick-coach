// Builds the updater manifest (latest.json) from the signed bundles in a directory.
// Usage: node scripts/make-latest-json.mjs <dir> <version> <tag> <owner/repo> [notes]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Which signed bundle serves which updater platform.
const PLATFORMS = [
  { key: 'linux-x86_64', test: n => n.endsWith('.AppImage') },
  { key: 'windows-x86_64', test: n => n.endsWith('-setup.exe') }
];

export function buildManifest({ files, read, version, tag, repo, notes = '', now = new Date() }) {
  const platforms = {};
  for (const { key, test } of PLATFORMS) {
    const bundle = files.find(f => test(f) && files.includes(f + '.sig'));
    if (!bundle) continue;
    platforms[key] = {
      signature: read(bundle + '.sig').trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(bundle)}`
    };
  }
  if (!Object.keys(platforms).length) throw new Error('No signed bundles found (looked for *.AppImage and *-setup.exe with a .sig next to them).');
  return { version, notes, pub_date: now.toISOString(), platforms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, version, tag, repo, notes] = process.argv.slice(2);
  if (!dir || !version || !tag || !repo) { console.error('usage: make-latest-json.mjs <dir> <version> <tag> <owner/repo> [notes]'); process.exit(2); }
  const manifest = buildManifest({ files: readdirSync(dir), read: f => readFileSync(join(dir, f), 'utf8'), version, tag, repo, notes });
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote latest.json for ${Object.keys(manifest.platforms).join(', ')}`);
}
