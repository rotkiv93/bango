import { create } from 'zustand';
import { createUiSlice } from './state/ui-slice.js';
import { createWorkspaceSlice } from './state/workspace-slice.js';
import type { State } from './state/types.js';

export { bango } from './state/bango.js';
export type { MetamodelView, OverviewView, Page } from './state/types.js';

/** The app state: what the user is looking at (`ui-slice`) next to the workspace and the engine's answers about it (`workspace-slice`). */
export const useWorkspace = create<State>()((...args) => ({
  ...createUiSlice(...args),
  ...createWorkspaceSlice(...args)
}));
