// Auto-update via the Tauri updater plugin (global API, available because withGlobalTauri is on).
// The desktop app only: in a browser, or in a build without the plugin, everything here is a no-op.
export const RELEASES_URL = 'https://github.com/aaronjohnweiss/stick-coach/releases/latest';

export const updaterAvailable = tauri => !!(tauri && tauri.updater && typeof tauri.updater.check === 'function');

// Resolves to the Update (with .version and .body) or null when up to date. Rejects if the check itself fails.
export async function checkForUpdate(tauri) {
  if (!updaterAvailable(tauri)) return null;
  return (await tauri.updater.check()) || null;
}

// Download, install and restart. onStatus gets a short progress string; rejects with the install error.
export async function installUpdate(tauri, update, onStatus = () => { }) {
  let total = 0, got = 0;
  await update.downloadAndInstall(ev => {
    if (ev.event === 'Started') { total = (ev.data && ev.data.contentLength) || 0; onStatus('Downloading update...'); }
    else if (ev.event === 'Progress') {
      got += (ev.data && ev.data.chunkLength) || 0;
      onStatus(total ? `Downloading update... ${Math.min(100, Math.round(got * 100 / total))}%` : 'Downloading update...');
    } else if (ev.event === 'Finished') onStatus('Installing update...');
  });
  onStatus('Restarting...');
  if (tauri.process && tauri.process.relaunch) await tauri.process.relaunch();
}
