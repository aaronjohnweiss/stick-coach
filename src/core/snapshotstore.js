// Persistence for snapshots. In the desktop app they live in a JSON file in the app data folder (Rust commands
// snapshots_load / snapshots_save); in a plain browser they fall back to localStorage.
import { parseStore, serializeStore } from './snapshots.js';

const KEY = 'snapshots';

export function makeSnapshotStore({ tauri, local }) {
  const useFile = !!(tauri && tauri.core);
  return {
    kind: useFile ? 'file' : 'browser',
    async load() {
      const text = useFile ? await tauri.core.invoke('snapshots_load') : local && local.getItem(KEY);
      return parseStore(text);
    },
    async save(list) {
      const text = serializeStore(list);
      if (useFile) await tauri.core.invoke('snapshots_save', { data: text });
      else if (local) local.setItem(KEY, text);
      else throw new Error('No storage available');
    }
  };
}
