import type { WorkspaceData, WorkspaceStorage } from '@bango/engine/workspace';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Theme } from './types.js';

// v5: the examples are now basic, datamodel, gismodel, sensors, forms and lists, so older saved workspaces would not parse
const STORAGE_KEY = 'bango-workspace-v5';
const THEME_KEY = 'bango-theme';

/** The workspace in the browser's IndexedDB. When storage is unavailable the playground still works, it just forgets. */
export class IdbStorage implements WorkspaceStorage {
  async load() {
    try { return await idbGet<Partial<WorkspaceData>>(STORAGE_KEY); } catch { return undefined; }
  }

  async save(data: WorkspaceData) {
    try { await idbSet(STORAGE_KEY, data); } catch { /* storage unavailable */ }
  }
}

export function loadTheme(): Theme {
  try { if (localStorage.getItem(THEME_KEY) === 'light') return 'light'; } catch { /* storage blocked */ }
  return 'dark';
}

export function saveTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked */ }
}
