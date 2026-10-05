import type {
  BangoApi, BuildResult, CaseResult, CompositionInfo, GrammarInfo, ImportResult, InstanceState, JsonValue, MetamodelCase, SelectionCheck
} from '@bango/core';
import { emptyWorkspace, migrateWorkspace, type WorkspaceData, type WorkspaceStorage } from './data.js';
import { KeyedDebouncer } from './debounce.js';
import { CONSTRAINTS_TEMPLATE, IMPORT_TEMPLATE, SPEC_TEMPLATE, grammarTemplate } from './templates.js';
import { validateMetamodelName, validateProjectName } from './validation.js';

/** The scripts a metamodel can own besides its grammar. */
export type ScriptKind = 'constraints' | 'spec' | 'import';

const SCRIPTS: Record<ScriptKind, { files: 'constraints' | 'specs' | 'imports'; template: string }> = {
  constraints: { files: 'constraints', template: CONSTRAINTS_TEMPLATE },
  spec: { files: 'specs', template: SPEC_TEMPLATE },
  import: { files: 'imports', template: IMPORT_TEMPLATE }
};
const KINDS = Object.keys(SCRIPTS) as ScriptKind[];

/** What is known about the workspace and the open project: the saved data, plus the engine's answers about it. */
export interface WorkspaceState {
  workspace: WorkspaceData;
  activeProject?: string;
  composition?: CompositionInfo;
  /** every grammar of the workspace: the metamodels a project can choose from, plus libraries */
  catalog: GrammarInfo[];
  /** status of the open project's instances, mirrored from the engine */
  instances: InstanceState[];
  ready: boolean;
  build?: { result: BuildResult; project: string };
  building: boolean;
}

/** Why a project could not be created or changed: the composer's answer, in plain language. */
export type SelectionResult = { ok: true } | { ok: false; errors: string[]; suggested: string[] };
export type Outcome = { ok: true } | { ok: false; error: string };

export interface WorkspaceOptions {
  storage?: WorkspaceStorage;
  /** the workspace of a first visit (and what old saved workspaces are completed from) */
  seed?: () => WorkspaceData;
  /** how long to wait after the last edit before sending it to the engine / re-reading the instances / saving (ms) */
  delays?: { push?: number; refresh?: number; persist?: number };
  /** something that was sent in the background failed */
  onError?: (error: unknown) => void;
}

/**
 * Projects, metamodels and their scripts, on top of one engine. Everything an application needs to be a Bango editor that is not
 * drawing: which metamodels a project uses and whether they fit, keeping the engine in step with what is edited (debounced, per file),
 * the instances of the open project, building, importing, test cases, and saving. It talks to the engine only through `BangoApi`, so
 * the engine can be in the page or in a worker, and it has no UI: an app subscribes and renders `state`.
 */
export class WorkspaceController {
  private current: WorkspaceState = { workspace: emptyWorkspace(), catalog: [], instances: [], ready: false, building: false };
  private listeners = new Set<(state: WorkspaceState) => void>();
  private loadedGrammars = new Set<string>();
  private loadedScripts: Record<ScriptKind, Set<string>> = { constraints: new Set(), spec: new Set(), import: new Set() };
  private readonly delay: Required<NonNullable<WorkspaceOptions['delays']>>;
  private readonly timers: KeyedDebouncer;
  private unsubscribe?: () => void;

  constructor(private bango: BangoApi, private options: WorkspaceOptions = {}) {
    this.delay = { push: 350, refresh: 120, persist: 400, ...options.delays };
    this.timers = new KeyedDebouncer(options.onError);
  }

  get state(): WorkspaceState {
    return this.current;
  }

  /** The engine this controller drives, for what it does not wrap (typings, queries). */
  get engine(): BangoApi {
    return this.bango;
  }

  subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(patch: Partial<WorkspaceState>) {
    this.current = { ...this.current, ...patch };
    for (const l of [...this.listeners]) l(this.current);
  }

  /** Send everything that is waiting to the engine now, and wait until it has been absorbed. Called before anything that reads the engine. */
  async flush() {
    await this.timers.flush();
  }

  dispose() {
    this.timers.cancel();
    this.unsubscribe?.();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- internals

  private commit(workspace: WorkspaceData) {
    this.set({ workspace });
    this.timers.schedule('persist', this.delay.persist, async () => { await this.options.storage?.save(this.current.workspace); });
  }

  private selection(): string[] | undefined {
    const { workspace, activeProject } = this.current;
    return activeProject ? workspace.projects[activeProject]?.metamodels : undefined;
  }

  /** The metamodels of a selection, in the order of the catalog. */
  private ordered(names: string[]): string[] {
    return this.current.catalog.filter(g => g.extension && names.includes(g.name)).map(g => g.name);
  }

  /** Pull the instances from the engine, and mirror their texts into the saved project. */
  private async refreshInstances() {
    const instances = await this.bango.getInstances();
    const { workspace, activeProject } = this.current;
    const project = activeProject ? workspace.projects[activeProject] : undefined;
    this.set({ instances });
    if (!project) return;
    const texts = Object.fromEntries(instances.map(i => [i.metamodel, i.text]));
    if (JSON.stringify(texts) !== JSON.stringify(project.instances)) {
      this.commit({ ...workspace, projects: { ...workspace.projects, [project.name]: { ...project, instances: texts } } });
    }
  }

  private async recompose() {
    const [composition, catalog] = [await this.bango.compose(this.selection() ?? []), await this.bango.listMetamodels()];
    this.set({ composition, catalog });
    await this.refreshInstances();
  }

  private send(kind: ScriptKind, metamodel: string, code: string) {
    return kind === 'constraints' ? this.bango.setConstraints(metamodel, code) : kind === 'spec' ? this.bango.setSpec(metamodel, code) : this.bango.setImport(metamodel, code);
  }

  /** Make the engine's grammars, constraints, JSON mappings and import mappings match the workspace. */
  private async syncMetamodels(workspace: WorkspaceData) {
    for (const name of [...this.loadedGrammars]) {
      if (workspace.grammars[name] === undefined) { await this.bango.removeGrammar(name); this.loadedGrammars.delete(name); }
    }
    for (const [name, text] of Object.entries(workspace.grammars)) { await this.bango.setGrammar(name, text); this.loadedGrammars.add(name); }
    for (const kind of KINDS) {
      const files = workspace[SCRIPTS[kind].files];
      for (const name of [...this.loadedScripts[kind]]) {
        if (files[name] === undefined) { await this.send(kind, name, ''); this.loadedScripts[kind].delete(name); }
      }
      for (const [name, code] of Object.entries(files)) { await this.send(kind, name, code); this.loadedScripts[kind].add(name); }
    }
  }

  /** Load a project (or none): compose its metamodels and replace the engine's instances with its own. */
  private async open(workspace: WorkspaceData, project: string | undefined, syncGrammars: boolean) {
    await this.flush();
    if (syncGrammars) await this.syncMetamodels(workspace);
    const def = project ? workspace.projects[project] : undefined;
    const composition = await this.bango.compose(def?.metamodels ?? []);
    await this.bango.setInstances(def?.instances ?? {});
    const [instances, catalog] = [await this.bango.getInstances(), await this.bango.listMetamodels()];
    this.set({ workspace, activeProject: project, composition, catalog, instances, ready: true, build: undefined });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Load the saved workspace (or the examples) and bring the engine up to date with it. */
  async init() {
    const saved = await this.options.storage?.load();
    const seed = this.options.seed ?? emptyWorkspace;
    const workspace = saved ? migrateWorkspace(saved, seed) : seed();
    // the engine tells when an instance changes (an edit in any view): re-read, a moment after the last one
    this.unsubscribe = undefined;
    const off = await this.bango.subscribe(() => this.timers.schedule('refresh', this.delay.refresh, () => this.refreshInstances()));
    this.unsubscribe = () => { void off(); };
    await this.open(workspace, undefined, true);
  }

  /** Back to the examples. */
  async reset() {
    await this.open((this.options.seed ?? emptyWorkspace)(), undefined, true);
    this.timers.schedule('persist', 0, async () => { await this.options.storage?.save(this.current.workspace); });
  }

  // ----------------------------------------------------------------- projects

  checkSelection(selection: string[]): Promise<SelectionCheck> {
    return this.bango.checkSelection(selection);
  }

  /** Create a project and open it. The composer decides whether this combination of metamodels can be a project. */
  async createProject(name: string, selection: string[]): Promise<SelectionResult> {
    const { workspace } = this.current;
    const nameError = validateProjectName(name, Object.keys(workspace.projects));
    if (nameError) return { ok: false, errors: [nameError], suggested: [] };
    await this.flush();
    const check = await this.bango.checkSelection(selection);
    if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
    const project = name.trim();
    const next = { ...workspace, projects: { ...workspace.projects, [project]: { name: project, metamodels: this.ordered(selection), instances: {} } } };
    await this.open(next, project, false);
    this.commit(next);
    return { ok: true };
  }

  async openProject(name: string) {
    await this.open(this.current.workspace, name, false);
  }

  async deleteProject(name: string) {
    const { workspace, activeProject } = this.current;
    const { [name]: _removed, ...rest } = workspace.projects;
    const next = { ...workspace, projects: rest };
    if (activeProject === name) await this.open(next, undefined, false);
    this.commit(next);
  }

  /** Change the metamodels of the open project, with the same checks as creating one. */
  async setProjectMetamodels(selection: string[]): Promise<SelectionResult> {
    const { workspace, activeProject } = this.current;
    if (!activeProject) return { ok: false, errors: ['No project is open'], suggested: [] };
    await this.flush();
    const check = await this.bango.checkSelection(selection);
    if (!check.ok) return { ok: false, errors: check.errors, suggested: check.suggested };
    const project = workspace.projects[activeProject];
    this.commit({ ...workspace, projects: { ...workspace.projects, [activeProject]: { ...project, metamodels: this.ordered(selection) } } });
    await this.recompose();
    return { ok: true };
  }

  /** The final model of the open project, or the reasons it cannot be built. Sees every edit made before the call. */
  async buildProject() {
    const { activeProject } = this.current;
    if (!activeProject) return;
    this.set({ building: true });
    try {
      await this.flush();
      const result = await this.bango.build(activeProject);
      this.set({ build: { result, project: activeProject }, building: false });
    } catch (e) {
      this.set({ building: false, build: { project: activeProject, result: { ok: false, errors: [(e as Error).message], warnings: [] } } });
    }
  }

  // ---------------------------------------------------------------- instances

  async createInstance(metamodel: string): Promise<Outcome> {
    try {
      await this.flush();
      await this.bango.createInstance(metamodel);
      await this.refreshInstances();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async removeInstance(metamodel: string) {
    await this.bango.removeInstance(metamodel);
    await this.refreshInstances();
  }

  async undo(metamodel: string) {
    await this.bango.undo(metamodel);
    await this.refreshInstances();
  }

  async redo(metamodel: string) {
    await this.bango.redo(metamodel);
    await this.refreshInstances();
  }

  /** What importing this JSON into the open project would produce. Changes nothing. */
  async previewImport(json: JsonValue): Promise<ImportResult> {
    await this.flush();
    return this.bango.importJson(json);
  }

  /** Replace the instances of the open project with imported ones; instances of metamodels the import did not produce stay. */
  async applyImport(texts: Record<string, string>) {
    const current = Object.fromEntries(this.current.instances.map(i => [i.metamodel, i.text]));
    await this.bango.setInstances({ ...current, ...texts });
    await this.refreshInstances();
  }

  // --------------------------------------------------------------- metamodels

  editGrammar(name: string, text: string) {
    const { workspace } = this.current;
    this.commit({ ...workspace, grammars: { ...workspace.grammars, [name]: text } });
    this.timers.schedule(`grammar:${name}`, this.delay.push, async () => {
      await this.bango.setGrammar(name, text);
      await this.recompose();
    });
  }

  editScript(kind: ScriptKind, metamodel: string, code: string) {
    const { workspace } = this.current;
    const { files } = SCRIPTS[kind];
    this.commit({ ...workspace, [files]: { ...workspace[files], [metamodel]: code } });
    this.timers.schedule(`${kind}:${metamodel}`, this.delay.push, async () => {
      await this.send(kind, metamodel, code);
      await this.recompose();
    });
  }

  /** The first visit to a script creates the metamodel's (template) script. */
  ensureScript(kind: ScriptKind, metamodel: string) {
    const { files, template } = SCRIPTS[kind];
    if (this.current.workspace[files][metamodel] !== undefined) return;
    this.editScript(kind, metamodel, template);
    this.loadedScripts[kind].add(metamodel);
  }

  /** A new metamodel, from the minimal grammar. */
  async addGrammar(name: string): Promise<Outcome> {
    const { workspace } = this.current;
    const error = validateMetamodelName(name, Object.keys(workspace.grammars));
    if (error) return { ok: false, error };
    const text = grammarTemplate(name);
    this.commit({ ...workspace, grammars: { ...workspace.grammars, [name]: text } });
    this.loadedGrammars.add(name);
    await this.flush();
    await this.bango.setGrammar(name, text);
    await this.recompose();
    return { ok: true };
  }

  setCases(metamodel: string, cases: MetamodelCase[]) {
    const { workspace } = this.current;
    this.commit({ ...workspace, cases: { ...workspace.cases, [metamodel]: cases } });
  }

  /** Run the saved test cases of a metamodel against the grammar and scripts as they are now. */
  async runCases(metamodel: string, cases = this.current.workspace.cases[metamodel] ?? []): Promise<CaseResult[]> {
    await this.flush();
    return this.bango.runCases(metamodel, cases);
  }
}
