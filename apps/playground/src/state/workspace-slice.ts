import { WorkspaceController } from '@bango/engine/workspace';
import type { StateCreator } from 'zustand';
import { seedWorkspace } from '../seed.js';
import { bango } from './bango.js';
import { IdbStorage } from './persistence.js';
import type { State, WorkspaceSlice } from './types.js';

/** Projects, metamodels, scripts, saving, building, importing: all of it is `WorkspaceController`, in the library. */
const controller = new WorkspaceController(bango, {
  storage: new IdbStorage(),
  seed: seedWorkspace,
  onError: e => console.error('Bango workspace:', e)
});

/**
 * What this file adds is only what a screen needs: the controller's state mirrored into the store, and where to look after an action
 * (which tab, which page, a toast when something failed).
 */
export const createWorkspaceSlice: StateCreator<State, [], [], WorkspaceSlice> = (set, get) => {
  controller.subscribe(state => set(state));

  /** Which metamodel the Metamodels page shows: keep the current one if it still exists, else the first that is not a library. */
  const settleGrammar = () => {
    const { activeGrammar, workspace } = get();
    if (activeGrammar && workspace.grammars[activeGrammar] !== undefined) return;
    set({ activeGrammar: Object.keys(workspace.grammars).find(g => g !== 'common') ?? Object.keys(workspace.grammars)[0] });
  };

  return {
    ...controller.state,

    async init() {
      get().initTheme();
      await controller.init();
      settleGrammar();
      set({ activeTab: 'overview' });
    },

    checkSelection: selection => controller.checkSelection(selection),

    async createProject(name, selection) {
      const result = await controller.createProject(name, selection);
      if (result.ok) set({ page: 'project', activeTab: 'overview' });
      return result;
    },

    async openProject(name) {
      await controller.openProject(name);
      set({ page: 'project', activeTab: 'overview' });
    },

    async deleteProject(name) {
      await controller.deleteProject(name);
      set({ page: 'projects', activeTab: 'overview' });
    },

    async setProjectMetamodels(selection) {
      const result = await controller.setProjectMetamodels(selection);
      const { activeTab, workspace, activeProject } = get();
      const metamodels = activeProject ? workspace.projects[activeProject]?.metamodels ?? [] : [];
      if (result.ok && activeTab !== 'overview' && !metamodels.includes(activeTab)) set({ activeTab: 'overview' });
      return result;
    },

    async buildProject() {
      await controller.buildProject();
      set({ activeTab: 'overview' });
    },

    async createInstance(metamodel) {
      const result = await controller.createInstance(metamodel);
      if (result.ok) set({ activeTab: metamodel });
      else get().toast('error', result.error);
    },

    removeInstance: metamodel => controller.removeInstance(metamodel),
    undo: metamodel => controller.undo(metamodel),
    redo: metamodel => controller.redo(metamodel),

    previewImport: json => controller.previewImport(json),

    async applyImport(texts) {
      await controller.applyImport(texts);
      set({ activeTab: 'overview' });
    },

    editGrammar: (name, text) => controller.editGrammar(name, text),
    editConstraints: (metamodel, text) => controller.editScript('constraints', metamodel, text),
    editSpec: (metamodel, text) => controller.editScript('spec', metamodel, text),
    editImport: (metamodel, text) => controller.editScript('import', metamodel, text),
    ensureScript: (kind, metamodel) => controller.ensureScript(kind, metamodel),
    setCases: (metamodel, cases) => controller.setCases(metamodel, cases),
    runCases: (metamodel, cases) => controller.runCases(metamodel, cases),

    async addGrammar(name) {
      const result = await controller.addGrammar(name);
      if (result.ok) set({ activeGrammar: name, metamodelView: 'grammar' });
      else get().toast('error', result.error);
    },

    async reset() {
      await controller.reset();
      settleGrammar();
      set({ page: 'projects', activeTab: 'overview' });
      get().toast('info', 'The examples were restored');
    }
  };
};
