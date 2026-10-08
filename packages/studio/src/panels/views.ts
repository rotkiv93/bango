import type { AstRenderer, ModelRenderer } from '@bango/renderer';
import type { CodeEditor } from '@bango/renderer/text';
import { clear, empty, h } from '../dom.js';
import type { MetamodelFiles, Panel, PanelHost } from '../types.js';

/** The composed grammar: the metamodel with every import inlined, as the composer produces it. */
export class ComposedPanel implements Panel {
  private host!: HTMLElement;
  private editor?: CodeEditor;
  private message!: HTMLElement;
  private offRevision?: () => void;
  private seq = 0;

  constructor(private studio: PanelHost) {}

  mount(el: HTMLElement): void {
    this.host = h('div', { class: 'bs-host' });
    this.message = h('div', { hidden: true });
    el.append(this.message, this.host);
    this.offRevision = this.studio.onRevision(() => void this.refresh());
    void this.refresh();
  }

  activate(): void {
    this.editor?.editor.layout();
  }

  dispose(): void {
    this.seq++;
    this.offRevision?.();
    this.editor?.dispose();
  }

  private async refresh(): Promise<void> {
    const { studio } = this;
    const seq = ++this.seq;
    let text: string | undefined;
    let failure: string | undefined;
    try {
      text = await studio.bango.bundleText(studio.metamodel);
    } catch (e) {
      failure = (e as Error).message;
    }
    if (seq !== this.seq) return;
    clear(this.message);
    this.message.hidden = failure === undefined;
    this.host.hidden = failure !== undefined;
    if (failure !== undefined) {
      this.message.appendChild(empty('Not composed', `${failure}. Fix the grammar to see it with its imports inlined.`));
      return;
    }
    if (!this.editor) {
      this.editor = new studio.renderer.CodeEditor(studio.monaco, this.host, {
        uri: `inmemory://bango/studio/${studio.metamodel}/composed`,
        language: 'langium',
        value: text ?? '',
        theme: studio.input.theme ?? 'vs-dark',
        editorOptions: { readOnly: true }
      });
    } else {
      this.editor.setValue(text ?? '');
    }
  }
}

/** The grammar itself as a tree, drawn with the renderer library's AST view. */
export class AstPanel implements Panel {
  private view?: AstRenderer;
  private offRevision?: () => void;
  private seq = 0;

  constructor(private studio: PanelHost) {}

  mount(el: HTMLElement): void {
    const { studio } = this;
    studio.renderer.injectStyles(el.ownerDocument);
    const host = h('div', { class: 'bs-host bango-view' });
    el.appendChild(host);
    this.view = new studio.renderer.AstRenderer({ engine: studio.bango, metamodel: studio.metamodel, reveal: () => undefined }, 'instance');
    this.view.mount(host);
    this.offRevision = studio.onRevision(() => void this.refresh());
    void this.refresh();
  }

  dispose(): void {
    this.seq++;
    this.offRevision?.();
    this.view?.dispose();
    this.view = undefined;
  }

  private async refresh(): Promise<void> {
    const { studio } = this;
    const seq = ++this.seq;
    let ast;
    try { ast = await studio.bango.getGrammarAst(studio.metamodel); } catch { ast = undefined; }
    if (seq !== this.seq) return;
    await this.view?.update({ metamodel: studio.metamodel, text: '', ast, problems: [], stale: false, available: !!ast } as never);
  }
}

/** The views the preview offers for any metamodel; the visualizations of the metamodel being written come after them. */
const PREVIEW_VIEWS: { view: string; label: string; title: string }[] = [
  { view: 'text', label: 'Text', title: 'The instance as the grammar writes it' },
  { view: 'form', label: 'Form', title: 'The instance as a form' },
  { view: 'diagram', label: 'Diagram', title: 'The instance as a diagram' },
  { view: 'json', label: 'JSON', title: 'The instance through the JSON mapping' }
];

/** A live instance of the metamodel, in the renderer library's views: what a user of the metamodel will see. */
export class PreviewPanel implements Panel {
  private view = 'text';
  private renderer?: ModelRenderer;
  private host!: HTMLElement;
  private seg!: HTMLElement;
  private note!: HTMLElement;
  private offRevision?: () => void;
  private offViews?: () => void;
  private ready: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private studio: PanelHost) {}

  mount(el: HTMLElement): void {
    const { studio } = this;
    this.seg = h('div', { class: 'bs-seg', role: 'group', 'aria-label': 'View' });
    this.note = h('span', { class: 'bs-muted' });
    this.host = h('div', { class: 'bs-host' });
    el.append(h('div', { class: 'bs-toolbar' }, this.seg, this.note), this.host);
    this.paintViews();
    this.offRevision = studio.onRevision(() => void this.ensureInstance());
    // the visualizations being typed in their tab are views here, as soon as they load
    this.offViews = studio.visualizations.subscribe(() => this.viewsChanged());
    this.ready = this.start();
  }

  activate(): void {
    void this.ready.then(() => this.renderer?.refresh());
  }

  dispose(): void {
    this.disposed = true;
    this.offRevision?.();
    this.offViews?.();
    const renderer = this.renderer;
    this.renderer = undefined;
    void this.ready.then(() => renderer?.dispose());
  }

  private async start(): Promise<void> {
    const { studio } = this;
    const renderer = new studio.renderer.ModelRenderer(studio.bango, { onReveal: () => void this.setView('text'), visualizations: studio.visualizations });
    this.renderer = renderer;
    await this.ensureInstance();
    if (this.disposed) return;
    await renderer.mount(this.host, studio.metamodel, this.view);
  }

  /** The metamodel needs an instance to show: its sample, or the minimal valid one. */
  private async ensureInstance(): Promise<void> {
    const { studio } = this;
    const info = studio.catalog.find(g => g.name === studio.metamodel);
    this.note.textContent = info && !info.extension ? 'A library has no entry rule, so there is nothing to preview.' : '';
    if (!info?.extension) return;
    try {
      await studio.bango.createInstance(studio.metamodel);
    } catch (e) {
      this.note.textContent = (e as Error).message;
    }
  }

  /** The buttons: the fixed views, then those the metamodel brings (a broken file is one button that says why). */
  private paintViews(): void {
    const { studio } = this;
    const brought = studio.renderer.visualizationViews(studio.visualizations.get(studio.metamodel));
    const views = [...PREVIEW_VIEWS, ...brought.map(v => ({ view: v.id, label: v.label, title: v.error ?? v.description ?? v.label }))];
    clear(this.seg);
    for (const { view, label, title } of views) {
      this.seg.appendChild(h('button', { type: 'button', title, 'aria-pressed': view === this.view, onclick: () => void this.setView(view) }, label));
    }
  }

  private viewsChanged(): void {
    this.paintViews();
    // the renderer draws the view again from the new text by itself; a view that is gone is left for the one that is always there
    if (this.view.startsWith('viz:') && !this.seg.querySelector('[aria-pressed="true"]')) void this.setView('text');
  }

  private async setView(view: string): Promise<void> {
    this.view = view;
    this.paintViews();
    await this.ready;
    await this.renderer?.setView(view);
  }
}

/** The metamodels this one needs, read-only: their grammars and scripts as the engine has them. */
export class DependenciesPanel implements Panel {
  private editor?: CodeEditor;
  private current = '';

  constructor(private studio: PanelHost, private dependencies: Record<string, MetamodelFiles>) {}

  mount(el: HTMLElement): void {
    const names = Object.keys(this.dependencies).sort();
    if (!names.length) {
      el.appendChild(empty('No dependencies', 'This metamodel does not import another one.'));
      return;
    }
    const select = h('select', { 'aria-label': 'Metamodel' }, ...names.map(n => h('option', { value: n }, n)));
    const host = h('div', { class: 'bs-host' });
    el.append(h('div', { class: 'bs-toolbar' }, h('span', {}, 'Imported metamodel'), select, h('span', { class: 'bs-muted' }, 'read-only')), host);
    const show = (): void => {
      this.current = select.value;
      this.editor?.dispose();
      this.editor = new this.studio.renderer.CodeEditor(this.studio.monaco, host, {
        uri: `inmemory://bango/studio/${this.studio.metamodel}/dependency/${this.current}`,
        language: 'langium',
        value: this.dependencies[this.current]?.grammar ?? '',
        theme: this.studio.input.theme ?? 'vs-dark',
        editorOptions: { readOnly: true }
      });
    };
    select.addEventListener('change', show);
    show();
  }

  activate(): void {
    this.editor?.editor.layout();
  }

  dispose(): void {
    this.editor?.dispose();
  }
}
