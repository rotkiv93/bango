import type * as Monaco from 'monaco-editor/editor/editor.api';
import type { BangoApi, GrammarInfo, Problem } from '@bango/core';
import type { AstRenderer, ModelRenderer, VisualizationStore, visualizationViews } from '@bango/renderer';
import type { CodeEditor } from '@bango/renderer/text';

export type MonacoApi = typeof Monaco;

/** The text files of one metamodel. Everything but the grammar is optional: a metamodel may have no scripts and no tests. */
export interface MetamodelFiles {
  /** `<name>.langium` */
  grammar: string;
  /** `<name>.constraints.js` */
  constraints?: string | undefined;
  /** `<name>.scope.js` */
  scope?: string | undefined;
  /** `<name>.spec.js`: the JSON mapping */
  spec?: string | undefined;
  /** `<name>.import.js`: the JSON import */
  import?: string | undefined;
  /** `<name>.cases.json`: the test cases, a JSON array of `MetamodelCase` */
  cases?: string | undefined;
  /** `<name>.visualizations.js`: the views of its instances that only this metamodel can draw (run by the page, never by the engine) */
  visualizations?: string | undefined;
}

export type FileKey = keyof MetamodelFiles;

export const FILE_KEYS: readonly FileKey[] = ['grammar', 'constraints', 'scope', 'spec', 'import', 'cases', 'visualizations'];

/**
 * The part of `@bango/renderer` (and its `text` entry) that the studio draws with. The page hands it in, so the studio never has a
 * second copy of the renderer: the views registered on the page's copy (`registerTextRenderer`) are the ones the studio shows.
 */
export interface RendererLibrary {
  ModelRenderer: typeof ModelRenderer;
  VisualizationStore: typeof VisualizationStore;
  /** the views that the text of a `<name>.visualizations.js` makes */
  visualizationViews: typeof visualizationViews;
  /** declarations of what a `<name>.visualizations.js` is given, for its editor */
  VISUALIZATION_TYPINGS: string;
  AstRenderer: typeof AstRenderer;
  CodeEditor: typeof CodeEditor;
  injectStyles(doc?: Document): void;
  registerCodeLanguages(monaco: MonacoApi): void;
  javascriptMonarch: Parameters<MonacoApi['languages']['setMonarchTokensProvider']>[1];
}

/** Monaco's TypeScript/JavaScript service (`monaco-editor/language/typescript/monaco.contribution`), loaded on demand: it is several MB. */
export interface TypescriptService {
  javascriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    setDiagnosticsOptions(options: Record<string, unknown>): void;
    addExtraLib(content: string, filePath?: string): { dispose(): void };
  };
  ScriptTarget: { ES2022: number };
}

export interface StudioInput {
  /** The engine (in a worker). The studio loads the metamodels into it and composes them there. */
  bango: BangoApi;
  monaco: MonacoApi;
  renderer: RendererLibrary;
  /**
   * Gives the script editors completion on the AST types of the grammar, hover and errors for a misspelled property. Without it they
   * are plain editors. For example: `() => import('monaco-editor/language/typescript/monaco.contribution')`.
   */
  typescript?: (() => Promise<TypescriptService>) | undefined;
  /** The name of the metamodel being edited. */
  metamodel: string;
  files: MetamodelFiles;
  /** The metamodels it requires, with everything they need, by name: loaded as they are and shown read-only. */
  dependencies?: Record<string, MetamodelFiles> | undefined;
  /** Sample instances by metamodel name, for the preview (and for the metamodels it needs). Without any, the preview starts from the first test case, or from an empty instance. */
  instances?: Record<string, string> | undefined;
  readOnly?: boolean | undefined;
  /** Monaco theme (`vs-dark` by default) */
  theme?: string | undefined;
  fontSize?: number | undefined;
}

export interface StudioEvents {
  /** a file was edited (by typing or by the tests panel) */
  change: { key: FileKey; files: MetamodelFiles };
  /** the problems of the grammar, after each recomposition */
  problems: Problem[];
  /** the composed state of every grammar changed */
  catalog: GrammarInfo[];
}

export type Tab = 'grammar' | 'constraints' | 'scope' | 'spec' | 'import' | 'visualizations' | 'tests' | 'composed' | 'ast' | 'preview' | 'dependencies';

/** What a panel is given by the studio. */
export interface PanelHost {
  readonly input: StudioInput;
  readonly bango: BangoApi;
  readonly monaco: MonacoApi;
  readonly renderer: RendererLibrary;
  readonly metamodel: string;
  readonly files: MetamodelFiles;
  /** the visualizations of the metamodel as they are being edited: what the preview offers as views */
  readonly visualizations: VisualizationStore;
  /** the last list of grammars the engine reported */
  readonly catalog: GrammarInfo[];
  /** bumped each time the engine was given something new (the panels that derive from the composition refresh on it) */
  readonly revision: number;
  edit(key: FileKey, text: string): void;
  /** ask for a tab (the problem list shows a position in the grammar) */
  show(tab: Tab): void;
  onRevision(listener: () => void): () => void;
}

export interface Panel {
  mount(el: HTMLElement): void | Promise<void>;
  /** The tab became visible. */
  activate?(): void;
  reveal?(range: Parameters<CodeEditor['reveal']>[0]): void;
  dispose(): void;
}
