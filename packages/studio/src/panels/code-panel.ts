import type { Range0 } from '@bango/core';
import type { CodeEditor } from '@bango/renderer/text';
import { h } from '../dom.js';
import { loadScriptIntelligence, useTypings } from '../script-intelligence.js';
import type { FileKey, Panel, PanelHost } from '../types.js';

/**
 * The editor of the grammar or of one script. A script editor is a plain one until Monaco's TypeScript service has loaded (when the page
 * gave one): then it knows the AST types of the metamodel, so `entity.` completes to the fields of an entity and a misspelled property is
 * an error.
 */
export class CodePanel implements Panel {
  private editor?: CodeEditor;
  private offRevision?: () => void;
  private disposed = false;

  constructor(private studio: PanelHost, private key: FileKey, private options: { readOnly?: boolean } = {}) {}

  private get isScript(): boolean {
    return this.key !== 'grammar';
  }

  mount(el: HTMLElement): void {
    const { studio, key } = this;
    const host = h('div', { class: 'bs-host' });
    el.appendChild(host);
    studio.renderer.registerCodeLanguages(studio.monaco);
    this.editor = new studio.renderer.CodeEditor(studio.monaco, host, {
      uri: `inmemory://bango/studio/${studio.metamodel}/${key}`,
      language: this.isScript ? 'bango-js' : 'langium',
      value: studio.files[key] ?? '',
      onChange: text => studio.edit(key, text),
      // scripts share one global scope in the TypeScript service, so their models must not pile up
      disposeModel: this.isScript,
      theme: studio.input.theme ?? 'vs-dark',
      ...(studio.input.fontSize === undefined ? {} : { fontSize: studio.input.fontSize }),
      editorOptions: { readOnly: !!(this.options.readOnly ?? studio.input.readOnly) }
    });
    this.offRevision = studio.onRevision(() => this.refresh());
    if (this.isScript) void this.turnOnIntelligence();
    this.refresh();
  }

  activate(): void {
    this.editor?.editor.layout();
    if (this.isScript) this.refreshTypings();
  }

  reveal(range: Range0): void {
    this.editor?.reveal(range);
  }

  dispose(): void {
    this.disposed = true;
    this.offRevision?.();
    this.editor?.dispose();
    this.editor = undefined;
  }

  /** The text came from outside (a reset), or the composition changed: markers and typings follow. */
  private refresh(): void {
    const { studio, key } = this;
    this.editor?.setValue(studio.files[key] ?? '');
    if (key === 'grammar') {
      const info = studio.catalog.find(g => g.name === studio.metamodel);
      this.editor?.setProblems(info?.problems ?? []);
    } else {
      this.refreshTypings();
    }
  }

  /**
   * The TypeScript service has one set of declarations for every script editor, so the editor in view puts its own there: the AST types
   * of the metamodel for its scripts, what a visualization is given for the visualizations.
   */
  private refreshTypings(): void {
    const { studio, key } = this;
    if (!this.intelligent) return;
    const use = (dts: string) => { if (!this.disposed) return useTypings({ monaco: studio.monaco, renderer: studio.renderer, load: studio.input.typescript, dts }); };
    if (key === 'visualizations') void use(studio.renderer.VISUALIZATION_TYPINGS);
    else void studio.bango.getTypings(studio.metamodel).then(use, () => { /* keep the previous typings */ });
  }

  private intelligent = false;

  private async turnOnIntelligence(): Promise<void> {
    const { studio } = this;
    try {
      await loadScriptIntelligence({ monaco: studio.monaco, renderer: studio.renderer, load: studio.input.typescript });
    } catch {
      return; // no language service: the plain editor stays
    }
    if (this.disposed) return;
    this.intelligent = true;
    this.editor?.setLanguage('javascript');
    this.refreshTypings();
  }
}
