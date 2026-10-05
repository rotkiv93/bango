import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Workspace } from '../types.js';
import type { Theme } from './types.js';

// v5: the examples are now basic, datamodel, gismodel, sensors, forms and lists, so older saved workspaces would not parse
const STORAGE_KEY = 'bango-workspace-v5';
const THEME_KEY = 'bango-theme';

/** The saved workspace, or undefined when there is none (or storage is unavailable: the playground still works). */
export async function loadWorkspace(): Promise<Workspace | undefined> {
  try { return await idbGet<Workspace>(STORAGE_KEY); } catch { return undefined; }
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  try { await idbSet(STORAGE_KEY, workspace); } catch { /* storage unavailable */ }
}

export function loadTheme(): Theme {
  try { if (localStorage.getItem(THEME_KEY) === 'light') return 'light'; } catch { /* storage blocked */ }
  return 'dark';
}

export function saveTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked */ }
}

export function debounced<T extends unknown[]>(fn: (...args: T) => Promise<void> | void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => void fn(...args), ms);
  };
}
