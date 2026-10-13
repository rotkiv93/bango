import { problemsOf, type GrammarInfo, type Problem } from '@bango/core';
import { clear, h } from './dom.js';
import { CodePanel } from './panels/code-panel.js';
import { TestsPanel } from './panels/tests-panel.js';
import { AstPanel, ComposedPanel, DependenciesPanel, PreviewPanel } from './panels/views.js';
import { injectStyles } from './styles.js';
import { FILE_KEYS, type FileKey, type MetamodelFiles, type Panel, type PanelHost, type StudioEvents, type StudioInput, type Tab } from './types.js';
import type { VisualizationStore } from '@bango/renderer';

const SCRIPTS = {
  constraints: 'setConstraints',
  scope: 'setScope',
  spec: 'setSpec',
  import: 'setImport'
} as const;

const TAB_LABELS: Record<Tab, { label: string; title: string }> = {
  grammar: { label: 'Grammar', title: 'The Langium grammar' },
  constraints: { label: 'Constraints', title: 'Validation the grammar cannot express' },
  scope: { label: 'Scope', title: 'Which nodes each reference can point at, from where it is written' },
  spec: { label: 'JSON mapping', title: 'The piece of the JSON specification this metamodel owns' },
  import: { label: 'JSON import', title: 'How the project JSON becomes an instance of this metamodel: the inverse of the JSON mapping' },
  visualizations: { label: 'Visualizations', title: 'The views of its instances that only this metamodel knows how to draw (a class diagram, ...)' },
  tests: { label: 'Tests', title: 'Sample instances and what they must report' },
  composed: { label: 'Composed', title: 'The grammar with every import inlined' },
  ast: { label: 'AST', title: 'The grammar as a tree' },
  preview: { label: 'Preview', title: 'A live instance in the views a user will see' },
  dependencies: { label: 'Imports', title: 'The metamodels this one imports, read-only' }
};

type Listener<K extends keyof StudioEvents> = (payload: StudioEvents[K]) => void;

/**
 * A workbench to write one metamodel: its grammar and scripts in editors that know the language, its tests, the composed grammar, the
 * grammar as a tree, and a live instance in the library's views. It owns no storage and knows nothing of where the files come from
 * (a repository, a database): it is given the files, tells what changed, and the page saves.
 *
 *   const studio = new MetamodelStudio({ bango, monaco, renderer, metamodel: 'billing', files, dependencies });
 *   await studio.mount(el);
 *   studio.on('change', () => save(studio.files));
 */
export class MetamodelStudio implements PanelHost {
  readonly input: StudioInput;
  private current: MetamodelFiles;
  private baseline: MetamodelFiles;
  private _catalog: GrammarInfo[] = [];
  private _revision = 0;
  private composeError: string | undefined;
  private listeners: { [K in keyof StudioEvents]: Set<Listener<K>> } = { change: new Set(), problems: new Set(), catalog: new Set() };
  private revisionListeners = new Set<() => void>();
  private panels = new Map<Tab, { panel: Panel; el: HTMLElement }>();
  private tabButtons = new Map<Tab, HTMLButtonElement>();
  private tabs!: HTMLElement;
  private body!: HTMLElement;
  private problemsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private root?: HTMLElement;
  private active: Tab = 'grammar';
  private problemsOpen = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshSeq = 0;
  private disposed = false;
  private sent = new Map<string, string>();
  readonly visualizations: VisualizationStore;

  constructor(input: StudioInput) {
    this.input = input;
    this.current = { ...input.files };
    this.baseline = { ...input.files };
    this.visualizations = new input.renderer.VisualizationStore();
    this.visualizations.set(input.metamodel, input.files.visualizations);
  }

  // ------------------------------------------------------------------ the page's side

  get files(): MetamodelFiles {
    return { ...this.current };
  }

  /** The files that differ from what the studio was given (or from the last `markSaved`). */
  dirty(): FileKey[] {
    return FILE_KEYS.filter(key => (this.current[key] ?? '') !== (this.baseline[key] ?? ''));
  }

  /** The files as they are now are the saved ones. */
  markSaved(): void {
    this.baseline = { ...this.current };
  }

  /** Replace the files from outside (after discarding changes, or loading another version). */
  async reset(files: MetamodelFiles): Promise<void> {
    this.current = { ...files };
    this.baseline = { ...files };
    this.visualizations.set(this.input.metamodel, files.visualizations);
    await this.pushFiles(this.input.metamodel, this.current);
    await this.refresh();
  }

  on<K extends keyof StudioEvents>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener);
    return () => { this.listeners[event].delete(listener); };
  }

  /** Loads the metamodels into the engine, composes them and draws the studio in `el`. */
  async mount(el: HTMLElement): Promise<void> {
    if (this.root) throw new Error('This MetamodelStudio is already mounted; call dispose() first');
    injectStyles(el.ownerDocument);
    this.input.renderer.injectStyles(el.ownerDocument);
    const { bango, metamodel } = this.input;
    for (const [name, files] of Object.entries(this.input.dependencies ?? {})) {
      if (name !== metamodel) await this.pushFiles(name, files);
    }
    await this.pushFiles(metamodel, this.current);
    await this.refresh();
    if (this.disposed) return;
    await bango.setInstances(this.sampleInstances()).catch(() => { /* a sample that does not fit is reported by the views */ });

    this.tabs = h('div', { class: 'bs-tabs', role: 'tablist' });
    this.statusEl = h('span', { class: 'bs-status' });
    this.body = h('div', { class: 'bs-body' });
    this.problemsEl = h('div', { class: 'bs-problems' });
    this.root = h('div', { class: 'bs' }, h('div', { class: 'bs-bar' }, this.tabs, h('span', { class: 'bs-spacer' }), this.statusEl), this.body, this.problemsEl);
    el.appendChild(this.root);
    this.paint();
    this.show(this.active);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const { panel } of this.panels.values()) panel.dispose();
    this.panels.clear();
    this.revisionListeners.clear();
    for (const set of Object.values(this.listeners)) (set as Set<unknown>).clear();
    this.root?.remove();
    this.root = undefined;
  }

  // ------------------------------------------------------------------ what the panels use

  get bango() { return this.input.bango; }
  get monaco() { return this.input.monaco; }
  get renderer() { return this.input.renderer; }
  get metamodel() { return this.input.metamodel; }
  get catalog(): GrammarInfo[] { return this._catalog; }
  get revision(): number { return this._revision; }

  onRevision(listener: () => void): () => void {
    this.revisionListeners.add(listener);
    return () => { this.revisionListeners.delete(listener); };
  }

  edit(key: FileKey, text: string): void {
    if (this.input.readOnly || (this.current[key] ?? '') === text) return;
    this.current = { ...this.current, [key]: text };
    for (const listener of this.listeners.change) listener({ key, files: this.files });
    this.paintTabs();
    if (key === 'cases') return;
    if (key === 'visualizations') {
      // page code: the engine never sees it. The preview's views follow what is typed
      this.visualizations.set(this.input.metamodel, text);
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pushKey(key).then(() => this.refresh()), 150);
  }

  show(tab: Tab): void {
    if (!this.root) return;
    this.active = tab;
    let entry = this.panels.get(tab);
    if (!entry) {
      const el = h('div', { class: 'bs-panel', role: 'tabpanel' });
      this.body.appendChild(el);
      const panel = this.createPanel(tab);
      entry = { panel, el };
      this.panels.set(tab, entry);
      void Promise.resolve(panel.mount(el)).then(() => { if (this.active === tab) panel.activate?.(); });
    }
    for (const [name, { el }] of this.panels) el.classList.toggle('on', name === tab);
    for (const [name, button] of this.tabButtons) button.setAttribute('aria-selected', String(name === tab));
    entry.panel.activate?.();
  }

  // ------------------------------------------------------------------ engine

  private createPanel(tab: Tab): Panel {
    switch (tab) {
      case 'grammar': case 'constraints': case 'scope': case 'spec': case 'import': case 'visualizations': return new CodePanel(this, tab);
      case 'tests': return new TestsPanel(this);
      case 'composed': return new ComposedPanel(this);
      case 'ast': return new AstPanel(this);
      case 'preview': return new PreviewPanel(this);
      case 'dependencies': return new DependenciesPanel(this, this.input.dependencies ?? {});
    }
  }

  private async pushKey(key: FileKey): Promise<void> {
    if (this.disposed) return;
    const name = this.input.metamodel;
    if (key === 'grammar') await this.send(name, 'grammar', this.current.grammar, () => this.bango.setGrammar(name, this.current.grammar));
    else if (key !== 'cases' && key !== 'visualizations') await this.sendScript(name, key, this.current[key]);
  }

  /** Give the engine a file only when it differs from what it has: a script that was never written is not sent at all. */
  private async send(name: string, key: string, text: string, push: () => Promise<void>): Promise<void> {
    const id = `${name}/${key}`;
    const previous = this.sent.get(id);
    if (previous === text || (previous === undefined && text === '')) return;
    this.sent.set(id, text);
    await push();
  }

  private sendScript(name: string, key: keyof typeof SCRIPTS, text: string | undefined): Promise<void> {
    return this.send(name, key, text ?? '', () => this.bango[SCRIPTS[key]](name, text ?? ''));
  }

  private async pushFiles(name: string, files: MetamodelFiles): Promise<void> {
    await this.send(name, 'grammar', files.grammar, () => this.bango.setGrammar(name, files.grammar));
    for (const key of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) await this.sendScript(name, key, files[key]);
  }

  /** Ask the engine what the grammars say now and compose the metamodel with what it needs. */
  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const seq = ++this.refreshSeq;
    const { bango, metamodel } = this.input;
    let catalog: GrammarInfo[] = [];
    let composeError: string | undefined;
    try {
      catalog = await bango.listMetamodels();
      const info = catalog.find(g => g.name === metamodel);
      if (info?.extension) {
        try {
          await bango.compose([metamodel, ...info.requires]);
          catalog = await bango.listMetamodels();
        } catch (e) {
          composeError = (e as Error).message;
        }
      }
    } catch (e) {
      composeError = (e as Error).message;
    }
    if (seq !== this.refreshSeq || this.disposed) return;
    this._catalog = catalog;
    this.composeError = composeError;
    this._revision++;
    this.paint();
    for (const listener of [...this.revisionListeners]) listener();
    for (const listener of this.listeners.catalog) listener(catalog);
    for (const listener of this.listeners.problems) listener(this.problems());
  }

  /** What the preview starts from: the page's samples, or else the first test case (with the instances it needs), or else a bare instance. */
  private sampleInstances(): Record<string, string> {
    if (this.input.instances) return this.input.instances;
    try {
      const first = (JSON.parse(this.current.cases || '[]') as { text?: unknown; with?: Record<string, string> }[])[0];
      if (typeof first?.text === 'string' && first.text.trim() !== '') return { ...first.with, [this.input.metamodel]: first.text };
    } catch { /* the tests panel says what is wrong with the cases file */ }
    return {};
  }

  private info(): GrammarInfo | undefined {
    return this._catalog.find(g => g.name === this.input.metamodel);
  }

  private problems(): Problem[] {
    const problems = this.info()?.problems ?? [];
    return this.composeError
      ? [...problems, { severity: 'error', message: this.composeError, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 } as Problem]
      : problems;
  }

  // ------------------------------------------------------------------ chrome

  private visibleTabs(): Tab[] {
    const info = this.info();
    const tabs: Tab[] = ['grammar'];
    if (!info || info.extension) tabs.push('constraints', 'scope', 'spec', 'import', 'visualizations', 'tests', 'composed', 'ast', 'preview');
    if (Object.keys(this.input.dependencies ?? {}).length > 0) tabs.push('dependencies');
    return tabs;
  }

  private paint(): void {
    if (!this.root) return;
    const tabs = this.visibleTabs();
    if (!tabs.includes(this.active)) this.show('grammar');
    const same = tabs.length === this.tabButtons.size && tabs.every(t => this.tabButtons.has(t));
    if (!same) {
      clear(this.tabs);
      this.tabButtons.clear();
      for (const tab of tabs) {
        const { label, title } = TAB_LABELS[tab];
        const button = h('button', { type: 'button', class: 'bs-tab', role: 'tab', title, 'aria-selected': tab === this.active, onclick: () => this.show(tab) }, label);
        this.tabButtons.set(tab, button);
        this.tabs.appendChild(button);
      }
    }
    this.paintTabs();
    const problems = this.problems();
    const errors = problemsOf(problems, 'error').length;
    const warnings = problemsOf(problems, 'warning').length;
    this.statusEl.className = `bs-status ${errors ? 'err' : warnings ? 'warn' : 'ok'}`;
    this.statusEl.textContent = errors ? `✖ ${errors}` : warnings ? `⚠ ${warnings}` : '✓';
    this.paintProblems(problems, errors, warnings);
  }

  /** Mark the tabs whose file has content, and count the tests. */
  private paintTabs(): void {
    for (const [tab, button] of this.tabButtons) {
      const base = TAB_LABELS[tab].label;
      let label = base;
      if (tab === 'tests') {
        const n = this.caseCount();
        if (n) label = `${base} (${n})`;
      } else if ((tab in SCRIPTS || tab === 'visualizations') && (this.current[tab as FileKey] ?? '').trim() !== '') label = `${base} •`;
      if (button.textContent !== label) button.textContent = label;
    }
  }

  private caseCount(): number {
    try {
      const parsed: unknown = JSON.parse(this.current.cases || '[]');
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch { return 0; }
  }

  private paintProblems(problems: Problem[], errors: number, warnings: number): void {
    clear(this.problemsEl);
    if (!problems.length) {
      this.problemsEl.appendChild(h('div', { class: 'bs-problems-head' }, '✓ No problems'));
      return;
    }
    const head = h('button', { type: 'button', class: 'bs-problems-head', 'aria-expanded': this.problemsOpen, onclick: () => { this.problemsOpen = !this.problemsOpen; this.paintProblems(problems, errors, warnings); } },
      h('span', {}, `${this.problemsOpen ? '▾' : '▸'} Problems`),
      errors ? h('span', { class: 'bs-status err' }, `✖ ${errors}`) : null,
      warnings ? h('span', { class: 'bs-status warn' }, `⚠ ${warnings}`) : null);
    this.problemsEl.appendChild(head);
    if (!this.problemsOpen) return;
    this.problemsEl.appendChild(h('ul', {}, ...problems.map(p => h('li', { class: p.severity },
      h('button', { type: 'button', onclick: () => this.reveal(p) },
        h('span', { class: 'pos' }, `${p.startLine + 1}:${p.startColumn + 1}`), p.message)))));
  }

  private reveal(p: Problem): void {
    this.show('grammar');
    this.panels.get('grammar')?.panel.reveal?.({ startLine: p.startLine, startColumn: p.startColumn, endLine: p.endLine, endColumn: p.endColumn });
  }
}
