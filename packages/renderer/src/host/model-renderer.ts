import type { EngineApi, PathStep, Range0 } from '@bango/core';
import { clear, h } from '../dom/dom.js';
import { FormRenderer } from '../views/form/form-renderer.js';
import { MemoryLayoutStore, VISUALIZATION_PREFIX, VisualizationStore, kit, loadVisualizations, visualizationViews } from '../visualizations/store.js';
import type { LayoutStore, ViewInfo, Visualization, VisualizationState } from '../visualizations/types.js';
import { getRenderer, registeredViews } from './registry.js';
import { injectStyles } from '../dom/styles.js';
import type { InstanceRenderer, ViewKind } from './types.js';

export interface ModelRendererOptions {
  /**
   * A view asks to show a source position (a diagram node was clicked, say). By default the same
   * metamodel switches to its text view; pass this to handle it yourself, e.g. to open another tab.
   */
  onReveal?(metamodel: string, range: Range0): void;
  /** skip adding the default stylesheet (you bring your own CSS) */
  noStyles?: boolean;
  /** the visualizations the metamodels bring (`<name>.visualizations.js`); each is offered as a view named `viz:<id>` */
  visualizations?: VisualizationStore;
  /** where the visualizations keep the positions of their nodes; in memory by default (lost with the page) */
  layouts?: LayoutStore;
  /** a visualization has a panel at its side that edits the node you select (default true) */
  inspector?: boolean;
}

const BUILTIN_LABELS: Record<string, string> = {
  text: 'Text', form: 'Form', diagram: 'Diagram', ast: 'AST', 'project-ast': 'Project AST', json: 'JSON', 'project-json': 'Project JSON'
};

/**
 * Shows one metamodel's instance in an element and keeps it in sync with the engine.
 * Switch between views (`text`, `form`, `diagram`, `ast`, ... and the visualizations of the metamodel) without losing the instance.
 *
 *   const view = new ModelRenderer(engine, { visualizations });
 *   await view.mount(el, 'datamodel', 'form');
 *   await view.setView('viz:class-diagram');
 */
export class ModelRenderer {
  private el?: HTMLElement;
  private container?: HTMLElement;
  private renderer?: InstanceRenderer;
  private inspector?: { form: FormRenderer; panel: HTMLElement };
  private _view: ViewKind = 'text';
  private _metamodel = '';
  private unsubscribe?: () => void;
  private disposed = false;
  private token = 0;
  private refreshSeq = 0;
  private readonly layouts: LayoutStore;

  constructor(private engine: EngineApi, private options: ModelRendererOptions = {}) {
    this.layouts = options.layouts ?? new MemoryLayoutStore();
  }

  get view(): ViewKind { return this._view; }
  get metamodel(): string { return this._metamodel; }

  /** The views this metamodel can be shown in: the built-in ones, and those it brings (named `viz:<id>`). */
  views(metamodel: string = this._metamodel): ViewInfo[] {
    const builtin = registeredViews().filter(id => id in BUILTIN_LABELS).map((id): ViewInfo => ({ id, label: BUILTIN_LABELS[id], kind: 'builtin' }));
    return [...builtin, ...visualizationViews(this.options.visualizations?.get(metamodel))];
  }

  /** Called when the visualizations of some metamodel change (so a tab list can be redrawn). Returns what stops it. */
  onViewsChange(listener: () => void): () => void {
    return this.options.visualizations?.subscribe(listener) ?? (() => undefined);
  }

  async mount(el: HTMLElement, metamodel: string, view: ViewKind = 'text'): Promise<void> {
    if (this.el) throw new Error('This ModelRenderer is already mounted; call dispose() first');
    this.disposed = false;
    this.el = el;
    this._metamodel = metamodel;
    if (!this.options.noStyles) injectStyles(el.ownerDocument);
    const unsubscribe = await this.engine.subscribe(() => void this.refresh());
    if (this.disposed) { unsubscribe(); return; }
    this.unsubscribe = unsubscribe;
    // the visualizations of this metamodel changed (someone is writing them): draw the view again from the new text
    const stopWatching = this.options.visualizations?.subscribe(() => {
      if (this._view.startsWith(VISUALIZATION_PREFIX) && this.el) void this.show(this._view).catch(() => undefined);
    });
    if (stopWatching) { const stop = this.unsubscribe; this.unsubscribe = () => { stop(); stopWatching(); }; }
    await this.show(view);
  }

  async setView(view: ViewKind): Promise<void> {
    if (view === this._view && this.renderer) return;
    await this.show(view);
  }

  async setMetamodel(metamodel: string): Promise<void> {
    this._metamodel = metamodel;
    await this.show(this._view);
  }

  /** Select and show a source range, switching to the text view when the current view cannot. */
  async reveal(range: Range0): Promise<void> {
    if (!this.renderer?.reveal) await this.setView('text');
    this.renderer?.reveal?.(range);
  }

  /** Re-read the instance from the engine and update the view. Called automatically on engine events. */
  async refresh(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer || this.disposed) return;
    const seq = ++this.refreshSeq;
    const viz = this._view.startsWith(VISUALIZATION_PREFIX);
    const [state, contributed] = await Promise.all([this.engine.getInstance(this._metamodel), viz ? this.engine.getContributed() : Promise.resolve([])]);
    if (this.disposed || renderer !== this.renderer || seq !== this.refreshSeq) return;
    if (viz) {
      try {
        // the read-only instances that others offer, to draw next to the project's own
        const drawn: VisualizationState = { ...state, offered: contributed.filter(c => c.available && c.ast) };
        await renderer.update(drawn);
        // the inspector is a form of the whole instance: only keep it up to date while it is open
        if (this.inspector && this.inspector.panel.style.display !== 'none') await this.inspector.form.update(state);
      } catch (e) {
        this.showProblem(`The view '${this._view}' failed: ${(e as Error).message}`);
      }
      return;
    }
    await renderer.update(state);
  }

  dispose(): void {
    this.disposed = true;
    this.token++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.teardown();
    this.container?.remove();
    this.container = undefined;
    this.el = undefined;
  }

  // ---------------------------------------------------------------- internals

  private teardown() {
    this.renderer?.dispose();
    this.renderer = undefined;
    this.inspector?.form.dispose();
    this.inspector = undefined;
  }

  private async show(view: ViewKind): Promise<void> {
    if (!this.el) throw new Error('Call mount() first');
    const token = ++this.token;
    const visualization = view.startsWith(VISUALIZATION_PREFIX) ? this.visualizationFor(view) : undefined;
    const factory = view.startsWith(VISUALIZATION_PREFIX) ? undefined : getRenderer(view); // throws a helpful error before anything is torn down
    this.teardown();
    if (this.container) clear(this.container);
    else this.el.appendChild((this.container = h('div')));
    this.container!.className = `bango-view bango-view-${view.replace(/[^\w-]/g, '-')}`;

    if (visualization === undefined && view.startsWith(VISUALIZATION_PREFIX) || (visualization instanceof Error)) {
      this._view = view;
      this.renderer = { mount: () => undefined, update: () => undefined, dispose: () => undefined };
      this.showProblem(visualization instanceof Error ? visualization.message : `No view '${view}' for '${this._metamodel}'`);
      return;
    }

    const context = {
      engine: this.engine,
      metamodel: this._metamodel,
      reveal: (metamodel: string, range: Range0) => this.handleReveal(metamodel, range)
    };
    let renderer: InstanceRenderer;
    let host = this.container!;
    if (visualization) {
      this.container!.classList.add('bango-view-viz');
      const main = h('div', { class: 'bango-viz-main' });
      this.container!.appendChild(main);
      host = main;
      if (this.options.inspector !== false) this.inspector = this.makeInspector(context);
      try {
        renderer = visualization.create({
          ...context,
          layout: {
            get: () => this.layouts.get(this._metamodel, view),
            set: positions => this.layouts.set(this._metamodel, view, positions)
          },
          inspect: path => this.inspect(path)
        }, kit);
      } catch (e) {
        this._view = view;
        this.renderer = { mount: () => undefined, update: () => undefined, dispose: () => undefined };
        this.showProblem(`The view '${visualization.label}' failed: ${(e as Error).message}`);
        return;
      }
    } else {
      renderer = factory!(context);
    }
    try {
      await renderer.mount(host);
    } catch (e) {
      if (!visualization) throw e;
      this._view = view;
      this.renderer = { mount: () => undefined, update: () => undefined, dispose: () => undefined };
      this.showProblem(`The view '${visualization.label}' failed: ${(e as Error).message}`);
      return;
    }
    if (token !== this.token || this.disposed) { renderer.dispose(); return; }
    this.renderer = renderer;
    this._view = view;
    await this.refresh();
  }

  /** The visualization a view name stands for; an error when the metamodel's file does not load; undefined when it has no such view. */
  private visualizationFor(view: string): Visualization | Error | undefined {
    const code = this.options.visualizations?.get(this._metamodel);
    if (code === undefined) return undefined;
    try {
      return loadVisualizations(code).find(v => VISUALIZATION_PREFIX + v.id === view);
    } catch (e) {
      return e as Error;
    }
  }

  private makeInspector(context: { engine: EngineApi; metamodel: string; reveal(metamodel: string, range: Range0): void }) {
    const panel = h('div', { class: 'bango-inspector' });
    panel.style.display = 'none';
    this.container!.appendChild(panel);
    const form = new FormRenderer(context);
    form.mount(panel);
    return { form, panel };
  }

  private inspect(path: PathStep[] | null) {
    const inspector = this.inspector;
    if (!inspector) return;
    inspector.panel.style.display = path ? '' : 'none';
    inspector.form.focus(path ?? undefined);
    // the form has the instance only after an update: ask for it when it is shown the first time
    if (path) void this.engine.getInstance(this._metamodel).then(state => inspector.form.update(state)).catch(() => undefined);
  }

  /** Put a message where the view is (a visualization that does not load, or that failed while drawing). */
  private showProblem(message: string) {
    if (!this.container) return;
    clear(this.container);
    this.container.classList.remove('bango-view-viz');
    this.container.appendChild(h('div', { class: 'bango-empty bango-form-error' }, message));
  }

  private handleReveal(metamodel: string, range: Range0) {
    if (this.options.onReveal) return this.options.onReveal(metamodel, range);
    if (metamodel === this._metamodel) void this.reveal(range);
  }
}

