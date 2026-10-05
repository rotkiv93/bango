import type { StateCreator } from 'zustand';
import { seedWorkspace } from '../seed.js';
import type { Workspace } from '../types.js';
import { bango } from './bango.js';
import { debounced, loadWorkspace, saveWorkspace } from './persistence.js';
import { CONSTRAINTS_TEMPLATE, SPEC_TEMPLATE, grammarTemplate } from './templates.js';
import type { ScriptKind, State, WorkspaceSlice } from './types.js';

/** The scripts a metamodel can own besides its grammar: where they live in the workspace and how they reach the worker. */
const SCRIPTS: Record<ScriptKind, { files: 'constraints' | 'specs'; template: string; send(metamodel: string, code: string): Promise<void> }> = {
  constraints: { files: 'constraints', template: CONSTRAINTS_TEMPLATE, send: (m, code) => bango.setConstraints(m, code) },
  spec: { files: 'specs', template: SPEC_TEMPLATE, send: (m, code) => bango.setSpec(m, code) }
};
const KINDS = Object.keys(SCRIPTS) as ScriptKind[];

export const createWorkspaceSlice: StateCreator<State, [], [], WorkspaceSlice> = (set, get) => {
  const loadedGrammars = new Set<string>();
  const loadedScripts: Record<ScriptKind, Set<string>> = { constraints: new Set(), spec: new Set() };

  const persist = debounced(() => saveWorkspace(get().workspace), 400);

  const commit = (workspace: Workspace) => {
    set({ workspace });
    persist();
  };

  const selection = () => {
    const { workspace, activeProject } = get();
    return activeProject ? workspace.projects[activeProject]?.metamodels : undefined;
  };

  /** The open project's metamodels, in the order of the catalog. */
  const ordered = (names: string[]) => get().catalog.filter(g => g.extension && names.includes(g.name)).map(g => g.name);

  /** Pull the instances from the engine, and mirror their texts into the persisted project. */
  const refreshInstances = async () => {
    const instances = await bango.getInstances();
    const { workspace, activeProject } = get();
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

  const pushScript = Object.fromEntries(KINDS.map(kind => [kind, debounced(async (metamodel: string, code: string) => {
    await SCRIPTS[kind].send(metamodel, code);
    await recompose();
  }, 350)])) as Record<ScriptKind, (metamodel: string, code: string) => void>;

  /** Make the worker's grammars, constraints and JSON mappings match the workspace. */
  const syncMetamodels = async (workspace: Workspace) => {
    for (const name of [...loadedGrammars]) {
      if (workspace.grammars[name] === undefined) { await bango.removeGrammar(name); loadedGrammars.delete(name); }
    }
    for (const [name, text] of Object.entries(workspace.grammars)) { await bango.setGrammar(name, text); loadedGrammars.add(name); }
    for (const kind of KINDS) {
      const { files, send } = SCRIPTS[kind];
      for (const name of [...loadedScripts[kind]]) {
        if (workspace[files][name] === undefined) { await send(name, ''); loadedScripts[kind].delete(name); }
      }
      for (const [name, code] of Object.entries(workspace[files])) { await send(name, code); loadedScripts[kind].add(name); }
    }
  };

  /** Load a project (or none): compose its metamodels and replace the engine's instances with its own. */
  const open = async (workspace: Workspace, project: string | undefined, syncGrammars: boolean) => {
    if (syncGrammars) await syncMetamodels(workspace);
    const def = project ? workspace.projects[project] : undefined;
    const composition = await bango.compose(def?.metamodels ?? []);
    await bango.setInstances(def?.instances ?? {});
    const [instances, catalog] = [await bango.getInstances(), await bango.listMetamodels()];
    const { activeGrammar } = get();
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

  const editScript = (kind: ScriptKind, metamodel: string, code: string) => {
    const { workspace } = get();
    const { files } = SCRIPTS[kind];
    commit({ ...workspace, [files]: { ...workspace[files], [metamodel]: code } });
    pushScript[kind](metamodel, code);
  };

  return {
    workspace: { grammars: {}, constraints: {}, specs: {}, projects: {} },
    catalog: [],
    instances: [],
    ready: false,
    building: false,

    async init() {
      get().initTheme();
      const workspace = (await loadWorkspace()) ?? seedWorkspace();
      workspace.specs ??= {};
      await bango.subscribe(() => scheduleRefresh());
      await open(workspace, undefined, true);
    },

    // ----------------------------------------------------------------- projects

    checkSelection: selection => bango.checkSelection(selection),

    async createProject(name, selection) {
      const { workspace } = get();
      // the composer decides whether this combination of metamodels can be a project
      const check = await bango.checkSelection(selection);
      if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
      if (workspace.projects[name]) return { ok: false, errors: [`A project called '${name}' already exists`], suggested: [] };
      const next = { ...workspace, projects: { ...workspace.projects, [name]: { name, metamodels: ordered(selection), instances: {} } } };
      await open(next, name, false);
      persist();
      set({ page: 'project' });
      return { ok: true };
    },

    async openProject(name) {
      await open(get().workspace, name, false);
      set({ page: 'project' });
    },

    async deleteProject(name) {
      const { workspace, activeProject } = get();
      const { [name]: _removed, ...rest } = workspace.projects;
      const next = { ...workspace, projects: rest };
      if (activeProject === name) await open(next, undefined, false);
      else set({ workspace: next });
      persist();
      set({ page: 'projects' });
    },

    async setProjectMetamodels(selection) {
      const { workspace, activeProject } = get();
      if (!activeProject) return { ok: false, errors: ['No project is open'], suggested: [] };
      const check = await bango.checkSelection(selection);
      if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
      const project = workspace.projects[activeProject];
      const metamodels = ordered(selection);
      commit({ ...workspace, projects: { ...workspace.projects, [activeProject]: { ...project, metamodels } } });
      await recompose();
      const { activeTab } = get();
      if (activeTab !== 'overview' && !metamodels.includes(activeTab)) set({ activeTab: 'overview' });
      return { ok: true };
    },

    async buildProject() {
      const { activeProject } = get();
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

    async createInstance(metamodel) {
      try {
        await bango.createInstance(metamodel);
        set({ activeTab: metamodel });
        await refreshInstances();
      } catch (e) {
        get().toast('error', (e as Error).message);
      }
    },

    async removeInstance(metamodel) {
      await bango.removeInstance(metamodel);
      await refreshInstances();
    },

    // --------------------------------------------------------------- metamodels

    editGrammar(name, text) {
      const { workspace } = get();
      commit({ ...workspace, grammars: { ...workspace.grammars, [name]: text } });
      pushGrammar(name, text);
    },

    editConstraints: (metamodel, text) => editScript('constraints', metamodel, text),
    editSpec: (metamodel, text) => editScript('spec', metamodel, text),

    ensureScript(kind, metamodel) {
      const { files, template } = SCRIPTS[kind];
      if (get().workspace[files][metamodel] !== undefined) return;
      editScript(kind, metamodel, template);
      loadedScripts[kind].add(metamodel);
    },

    async addGrammar(name) {
      const { workspace } = get();
      if (workspace.grammars[name] !== undefined) {
        get().toast('error', `A metamodel called '${name}' already exists`);
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
      await open(seedWorkspace(), undefined, true);
      persist();
      set({ page: 'projects' });
      get().toast('info', 'The examples were restored');
    }
  };
};
