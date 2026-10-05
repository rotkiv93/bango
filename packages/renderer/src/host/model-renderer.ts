import type { EngineApi, Range0 } from '@bango/core';
import { clear, h } from '../dom/dom.js';
import { getRenderer } from './registry.js';
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
}

/**
 * Shows one metamodel's instance in an element and keeps it in sync with the engine.
 * Switch between views (`text`, `form`, `diagram`, `ast`, ...) without losing the instance.
 *
 *   const view = new ModelRenderer(engine);
 *   await view.mount(el, 'datamodel', 'form');
 *   await view.setView('text');
 */
export class ModelRenderer {
  private el?: HTMLElement;
  private container?: HTMLElement;
  private renderer?: InstanceRenderer;
  private _view: ViewKind = 'text';
  private _metamodel = '';
  private unsubscribe?: () => void;
  private disposed = false;
  private token = 0;
  private refreshSeq = 0;

  constructor(private engine: EngineApi, private options: ModelRendererOptions = {}) {}

  get view(): ViewKind { return this._view; }
  get metamodel(): string { return this._metamodel; }

  async mount(el: HTMLElement, metamodel: string, view: ViewKind = 'text'): Promise<void> {
    if (this.el) throw new Error('This ModelRenderer is already mounted; call dispose() first');
    this.disposed = false;
    this.el = el;
    this._metamodel = metamodel;
    if (!this.options.noStyles) injectStyles(el.ownerDocument);
    const unsubscribe = await this.engine.subscribe(() => void this.refresh());
    if (this.disposed) { unsubscribe(); return; }
    this.unsubscribe = unsubscribe;
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
    const state = await this.engine.getInstance(this._metamodel);
    if (this.disposed || renderer !== this.renderer || seq !== this.refreshSeq) return;
    await renderer.update(state);
  }

  dispose(): void {
    this.disposed = true;
    this.token++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.container?.remove();
    this.container = undefined;
    this.el = undefined;
  }

  // ---------------------------------------------------------------- internals

  private async show(view: ViewKind): Promise<void> {
    if (!this.el) throw new Error('Call mount() first');
    const token = ++this.token;
    const factory = getRenderer(view); // throws a helpful error before anything is torn down
    this.renderer?.dispose();
    this.renderer = undefined;
    if (this.container) clear(this.container);
    else this.el.appendChild((this.container = h('div')));
    this.container!.className = `bango-view bango-view-${view.replace(/[^\w-]/g, '-')}`;

    const renderer = factory({
      engine: this.engine,
      metamodel: this._metamodel,
      reveal: (metamodel, range) => this.handleReveal(metamodel, range)
    });
    await renderer.mount(this.container!);
    if (token !== this.token || this.disposed) { renderer.dispose(); return; }
    this.renderer = renderer;
    this._view = view;
    await this.refresh();
  }

  private handleReveal(metamodel: string, range: Range0) {
    if (this.options.onReveal) return this.options.onReveal(metamodel, range);
    if (metamodel === this._metamodel) void this.reveal(range);
  }
}
