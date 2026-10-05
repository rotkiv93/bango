import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { connectBango } from '@bango/engine/worker';
import type { BuildResult, CompositionInfo, GrammarInfo, InstanceState, Range0, SelectionCheck } from '@bango/engine';
import type { ViewKind } from '@bango/renderer';
import { seedWorkspace } from './seed.js';
import { monaco } from './monaco.js';
import type { Workspace } from './types.js';

// v4: the examples moved to the product-specification grammars, so older saved workspaces would not parse
const STORAGE_KEY = 'bango-workspace-v4';
const THEME_KEY = 'bango-theme';

/** The library, running in a worker. Everything Langium happens behind this object. */
export const bango = connectBango(new Worker(new URL('./bango.worker.ts', import.meta.url), { type: 'module' }));

export type Page = 'projects' | 'project' | 'metamodels';
export type Theme = 'dark' | 'light';
export type MetamodelView = 'grammar' | 'constraints' | 'spec' | 'ast' | 'composed';
export type OverviewView = 'diagram' | 'project-json' | 'project-ast';
export interface Toast { id: number; kind: 'error' | 'success' | 'info'; text: string }

/** Why a project could not be created or changed (the composer's answer, in plain language). */
export type SelectionResult = { ok: true } | { ok: false; errors: string[]; suggested: string[] };

const CONSTRAINTS_TEMPLATE = `// Extra rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
// accept(severity, message, { node, property, index }) reports a problem on the node.
return {
};
`;

const SPEC_TEMPLATE = `// How this metamodel's instances become JSON: the piece of the specification it owns.
// Return a function. \`model\` is the root of the instance, \`refName(ref)\` the name a reference points at.
// The pieces of all metamodels are merged into one document.
return function (model, { refName }) {
  return {
    name: model.name
  };
};
`;

const grammarTemplate = (name: string) => {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  return `grammar ${pascal}
import 'common'

// ${pascal}: describe this metamodel in one line (shown when choosing metamodels for a project)
entry Model: '${name}' name=ID?;
`;
};

function readTheme(): Theme {
  try { if (localStorage.getItem(THEME_KEY) === 'light') return 'light'; } catch { /* storage blocked */ }
  return 'dark';
}

interface State {
  workspace: Workspace;
  activeProject?: string;
  composition?: CompositionInfo;
  /** every grammar of the workspace: the metamodels a project can choose from, plus libraries */
  catalog: GrammarInfo[];
  /** status of the open project's instances, mirrored from the engine */
  instances: InstanceState[];
  ready: boolean;
  theme: Theme;
  toasts: Toast[];

  page: Page;
  /** `overview` or the name of a metamodel of the open project */
  activeTab: string;
  instanceView: ViewKind;
  /** show the text next to the chosen view */
  split: boolean;
  overviewView: OverviewView;
  activeGrammar?: string;
  metamodelView: MetamodelView;
  /** asks the instance view to select a range (diagram/form/AST -> text) */
  reveal?: { metamodel: string; range: Range0; nonce: number };
  build?: { result: BuildResult; project: string };
  building: boolean;

  init(): Promise<void>;
  go(page: Page): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  toggleTheme(): void;

  checkSelection(selection: string[]): Promise<SelectionCheck>;
  createProject(name: string, selection: string[]): Promise<SelectionResult>;
  openProject(name: string): Promise<void>;
  deleteProject(name: string): Promise<void>;
  setProjectMetamodels(selection: string[]): Promise<SelectionResult>;
  buildProject(): Promise<void>;

  selectTab(tab: string): void;
  setInstanceView(view: ViewKind): void;
  setSplit(split: boolean): void;
  setOverviewView(view: OverviewView): void;
  createInstance(metamodel: string): Promise<void>;
  removeInstance(metamodel: string): Promise<void>;
  revealInText(metamodel: string, range: Range0): void;

  selectGrammar(name: string): void;
  setMetamodelView(view: MetamodelView): void;
  editGrammar(name: string, text: string): void;
  editConstraints(metamodel: string, text: string): void;
  editSpec(metamodel: string, text: string): void;
  addGrammar(name: string): Promise<void>;
  reset(): Promise<void>;
}

function debounced<T extends unknown[]>(fn: (...args: T) => Promise<void> | void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => void fn(...args), ms);
  };
}

export const useWorkspace = create<State>((set, getState) => {
  const loadedGrammars = new Set<string>();
  const loadedConstraints = new Set<string>();
  const loadedSpecs = new Set<string>();
  let toastId = 0;

  const persist = debounced(async () => {
    try { await idbSet(STORAGE_KEY, getState().workspace); } catch { /* storage unavailable: the playground still works */ }
  }, 400);

  const commit = (workspace: Workspace) => {
    set({ workspace });
    persist();
  };

  const selection = () => {
    const { workspace, activeProject } = getState();
    return activeProject ? workspace.projects[activeProject]?.metamodels : undefined;
  };

  /** Pull the instances from the engine, and mirror their texts into the persisted project. */
  const refreshInstances = async () => {
    const instances = await bango.getInstances();
    const { workspace, activeProject } = getState();
    const project = activeProject ? workspace.projects[activeProject] : undefined;
    set({ instances });
    if (!project) return;
    const texts = Object.fromEntries(instances.map(i => [i.metamodel, i.text]));
    if (JSON.stringify(texts) !== JSON.stringify(project.instances)) {
      commit({ ...workspace, projects: { ...workspace.projects, [project.name]: { ...project, instances: texts } } });
    }
  };
  const scheduleRefresh = debounced(refreshInstances, 120);

  const recompose = async () => {
    const [composition, catalog] = [await bango.compose(selection() ?? []), await bango.listMetamodels()];
    set({ composition, catalog });
    await refreshInstances();
  };

  const pushGrammar = debounced(async (name: string, text: string) => {
    await bango.setGrammar(name, text);
    await recompose();
  }, 350);

  const pushConstraints = debounced(async (metamodel: string, text: string) => {
    await bango.setConstraints(metamodel, text);
    await recompose();
  }, 350);

  const pushSpec = debounced(async (metamodel: string, text: string) => {
    await bango.setSpec(metamodel, text);
    await recompose();
  }, 350);

  /** Make the worker's grammars, constraints and JSON mappings match the workspace. */
  const syncMetamodels = async (workspace: Workspace) => {
    for (const name of [...loadedGrammars]) {
      if (workspace.grammars[name] === undefined) { await bango.removeGrammar(name); loadedGrammars.delete(name); }
    }
    for (const [name, text] of Object.entries(workspace.grammars)) { await bango.setGrammar(name, text); loadedGrammars.add(name); }
    for (const name of [...loadedConstraints]) {
      if (workspace.constraints[name] === undefined) { await bango.setConstraints(name, ''); loadedConstraints.delete(name); }
    }
    for (const [name, code] of Object.entries(workspace.constraints)) { await bango.setConstraints(name, code); loadedConstraints.add(name); }
    for (const name of [...loadedSpecs]) {
      if (workspace.specs[name] === undefined) { await bango.setSpec(name, ''); loadedSpecs.delete(name); }
    }
    for (const [name, code] of Object.entries(workspace.specs)) { await bango.setSpec(name, code); loadedSpecs.add(name); }
  };

  /** Load a project (or none): compose its metamodels and replace the engine's instances with its own. */
  const open = async (workspace: Workspace, project: string | undefined, syncGrammars: boolean) => {
    if (syncGrammars) await syncMetamodels(workspace);
    const def = project ? workspace.projects[project] : undefined;
    const composition = await bango.compose(def?.metamodels ?? []);
    await bango.setInstances(def?.instances ?? {});
    const [instances, catalog] = [await bango.getInstances(), await bango.listMetamodels()];
    const { activeGrammar } = getState();
    set({
      workspace,
      activeProject: project,
      composition,
      catalog,
      instances,
      ready: true,
      build: undefined,
      activeTab: 'overview',
      activeGrammar: activeGrammar && workspace.grammars[activeGrammar] !== undefined
        ? activeGrammar
        : Object.keys(workspace.grammars).find(g => g !== 'common') ?? Object.keys(workspace.grammars)[0]
    });
  };

  const applyTheme = (theme: Theme) => {
    document.documentElement.dataset.theme = theme;
    monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark');
  };

  return {
    workspace: { grammars: {}, constraints: {}, specs: {}, projects: {} },
    catalog: [],
    instances: [],
    ready: false,
    building: false,
    theme: readTheme(),
    toasts: [],
    page: 'projects',
    activeTab: 'overview',
    instanceView: 'text',
    split: false,
    overviewView: 'diagram',
    metamodelView: 'grammar',

    async init() {
      applyTheme(getState().theme);
      let workspace: Workspace | undefined;
      try { workspace = await idbGet<Workspace>(STORAGE_KEY); } catch { /* ignore */ }
      workspace ??= seedWorkspace();
      workspace.specs ??= {};
      await bango.subscribe(() => scheduleRefresh());
      await open(workspace, undefined, true);
    },

    go: page => set({ page }),

    toast(kind, text) {
      const id = ++toastId;
      set({ toasts: [...getState().toasts, { id, kind, text }] });
      setTimeout(() => getState().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast: id => set({ toasts: getState().toasts.filter(t => t.id !== id) }),

    toggleTheme() {
      const theme: Theme = getState().theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked */ }
      applyTheme(theme);
      set({ theme });
    },

    // ----------------------------------------------------------------- projects

    checkSelection: selection => bango.checkSelection(selection),

    async createProject(name, selection) {
      const { workspace } = getState();
      // the composer decides whether this combination of metamodels can be a project
      const check = await bango.checkSelection(selection);
      if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
      if (workspace.projects[name]) return { ok: false, errors: [`A project called '${name}' already exists`], suggested: [] };
      const ordered = getState().catalog.filter(g => g.extension && selection.includes(g.name)).map(g => g.name);
      const next = { ...workspace, projects: { ...workspace.projects, [name]: { name, metamodels: ordered, instances: {} } } };
      await open(next, name, false);
      persist();
      set({ page: 'project' });
      return { ok: true };
    },

    async openProject(name) {
      await open(getState().workspace, name, false);
      set({ page: 'project' });
    },

    async deleteProject(name) {
      const { workspace, activeProject } = getState();
      const { [name]: _removed, ...rest } = workspace.projects;
      const next = { ...workspace, projects: rest };
      if (activeProject === name) await open(next, undefined, false);
      else set({ workspace: next });
      persist();
      set({ page: 'projects' });
    },

    async setProjectMetamodels(selection) {
      const { workspace, activeProject } = getState();
      if (!activeProject) return { ok: false, errors: ['No project is open'], suggested: [] };
      const check = await bango.checkSelection(selection);
      if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
      const project = workspace.projects[activeProject];
      const ordered = getState().catalog.filter(g => g.extension && selection.includes(g.name)).map(g => g.name);
      commit({ ...workspace, projects: { ...workspace.projects, [activeProject]: { ...project, metamodels: ordered } } });
      await recompose();
      const { activeTab } = getState();
      if (activeTab !== 'overview' && !ordered.includes(activeTab)) set({ activeTab: 'overview' });
      return { ok: true };
    },

    async buildProject() {
      const { activeProject } = getState();
      if (!activeProject) return;
      set({ building: true });
      try {
        // calls reach the engine in order, so this sees every edit made before the click
        const result = await bango.build(activeProject);
        set({ build: { result, project: activeProject }, building: false, activeTab: 'overview' });
      } catch (e) {
        set({ building: false, build: { project: activeProject, result: { ok: false, errors: [(e as Error).message], warnings: [] } } });
      }
    },

    // ---------------------------------------------------------------- instances

    selectTab: tab => set({ activeTab: tab }),
    setInstanceView: view => set({ instanceView: view }),
    setSplit: split => set({ split, ...(split && getState().instanceView === 'text' ? { instanceView: 'form' as ViewKind } : {}) }),
    setOverviewView: view => set({ overviewView: view }),

    async createInstance(metamodel) {
      try {
        await bango.createInstance(metamodel);
        set({ activeTab: metamodel });
        await refreshInstances();
      } catch (e) {
        getState().toast('error', (e as Error).message);
      }
    },

    async removeInstance(metamodel) {
      await bango.removeInstance(metamodel);
      await refreshInstances();
    },

    revealInText(metamodel, range) {
      // in split mode the text is already beside the view, so keep the view as it is
      set({
        activeTab: metamodel,
        ...(getState().split ? {} : { instanceView: 'text' as ViewKind }),
        reveal: { metamodel, range, nonce: Date.now() }
      });
    },

    // --------------------------------------------------------------- metamodels

    selectGrammar: name => set({ activeGrammar: name }),

    setMetamodelView: view => {
      const { activeGrammar, workspace } = getState();
      // the first visit to the constraints view creates an (empty) constraints file for the metamodel
      if (view === 'constraints' && activeGrammar && workspace.constraints[activeGrammar] === undefined) {
        commit({ ...workspace, constraints: { ...workspace.constraints, [activeGrammar]: CONSTRAINTS_TEMPLATE } });
        loadedConstraints.add(activeGrammar);
        pushConstraints(activeGrammar, CONSTRAINTS_TEMPLATE);
      }
      // ... and so does the first visit to the JSON mapping
      if (view === 'spec' && activeGrammar && workspace.specs[activeGrammar] === undefined) {
        commit({ ...getState().workspace, specs: { ...getState().workspace.specs, [activeGrammar]: SPEC_TEMPLATE } });
        loadedSpecs.add(activeGrammar);
        pushSpec(activeGrammar, SPEC_TEMPLATE);
      }
      set({ metamodelView: view });
    },

    editGrammar(name, text) {
      const { workspace } = getState();
      commit({ ...workspace, grammars: { ...workspace.grammars, [name]: text } });
      pushGrammar(name, text);
    },

    editConstraints(metamodel, text) {
      const { workspace } = getState();
      commit({ ...workspace, constraints: { ...workspace.constraints, [metamodel]: text } });
      pushConstraints(metamodel, text);
    },

    editSpec(metamodel, text) {
      const { workspace } = getState();
      commit({ ...workspace, specs: { ...workspace.specs, [metamodel]: text } });
      pushSpec(metamodel, text);
    },

    async addGrammar(name) {
      const { workspace } = getState();
      if (workspace.grammars[name] !== undefined) {
        getState().toast('error', `A metamodel called '${name}' already exists`);
        return;
      }
      const text = grammarTemplate(name);
      commit({ ...workspace, grammars: { ...workspace.grammars, [name]: text } });
      set({ activeGrammar: name, metamodelView: 'grammar' });
      loadedGrammars.add(name);
      await bango.setGrammar(name, text);
      await recompose();
    },

    async reset() {
      const workspace = seedWorkspace();
      await open(workspace, undefined, true);
      persist();
      set({ page: 'projects' });
      getState().toast('info', 'The examples were restored');
    }
  };
});
