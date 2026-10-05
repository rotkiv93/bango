import type * as Monaco from 'monaco-editor/editor/editor.api';
import type { EngineApi, InstanceState, Range0 } from '@bango/engine';
import { h } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';
import { CodeEditor, ensureLanguage } from './code-editor.js';
import { monarchFor } from './monarch.js';

type MonacoApi = typeof Monaco;

export interface TextRendererOptions {
  theme?: string;
  fontSize?: number;
  /** how long to wait after the last keystroke before the engine re-parses (default 250 ms) */
  debounceMs?: number;
  editorOptions?: Monaco.editor.IStandaloneEditorConstructionOptions;
}

interface Binding { engine: EngineApi; metamodel: string }

/** What is shared by every text renderer that uses the same Monaco instance. */
interface Environment {
  /** model uri -> which engine and metamodel it shows (providers look this up) */
  bindings: Map<string, Binding>;
  tokenizers: Map<string, { keywords: string; disposable: Monaco.IDisposable }>;
  providers: Set<string>;
}

const environments = new WeakMap<object, Environment>();
const engineIds = new WeakMap<object, number>();
let nextEngineId = 0;

function environmentOf(monaco: MonacoApi): Environment {
  let env = environments.get(monaco);
  if (!env) environments.set(monaco, (env = { bindings: new Map(), tokenizers: new Map(), providers: new Set() }));
  return env;
}

const engineId = (engine: object) => {
  let id = engineIds.get(engine);
  if (id === undefined) engineIds.set(engine, (id = nextEngineId++));
  return id;
};

/** One model per (engine, metamodel): renderers on the same instance share undo history, and go-to-definition can open it. */
export const modelUri = (engine: object, metamodel: string) => `inmemory://bango/e${engineId(engine)}/${encodeURIComponent(metamodel)}`;
export const languageIdOf = (metamodel: string) => `bango-${metamodel}`;

const toMonacoRange = (r: Range0): Monaco.IRange => ({
  startLineNumber: r.startLine + 1, startColumn: r.startColumn + 1, endLineNumber: r.endLine + 1, endColumn: r.endColumn + 1
});

function registerProviders(monaco: MonacoApi, env: Environment, language: string) {
  if (env.providers.has(language)) return;
  env.providers.add(language);
  const bindingOf = (model: Monaco.editor.ITextModel) => env.bindings.get(model.uri.toString());

  monaco.languages.registerCompletionItemProvider(language, {
    async provideCompletionItems(model, position) {
      const b = bindingOf(model);
      if (!b) return { suggestions: [] };
      const items = await b.engine.complete(b.metamodel, model.getValue(), position.lineNumber - 1, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const fallback: Monaco.IRange = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn
      };
      return {
        suggestions: items.map(i => ({
          label: i.label,
          detail: i.detail,
          // LSP kinds: Keyword is 14, everything else we offer is a reference to something
          kind: i.kind === 14 ? monaco.languages.CompletionItemKind.Keyword : monaco.languages.CompletionItemKind.Reference,
          insertText: i.insertText,
          range: i.range ? toMonacoRange(i.range) : fallback
        }))
      };
    }
  });

  monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      const b = bindingOf(model);
      const text = b && (await b.engine.hover(b.metamodel, model.getValue(), position.lineNumber - 1, position.column - 1));
      return text ? { contents: [{ value: text }] } : undefined;
    }
  });

  monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position) {
      const b = bindingOf(model);
      if (!b) return [];
      const defs = await b.engine.definition(b.metamodel, model.getValue(), position.lineNumber - 1, position.column - 1);
      const result: Monaco.languages.Location[] = [];
      for (const d of defs) {
        const uri = monaco.Uri.parse(modelUri(b.engine, d.metamodel));
        if (!monaco.editor.getModel(uri)) {
          // the target instance is not open in an editor yet: give Monaco a model to jump into
          monaco.editor.createModel((await b.engine.getInstance(d.metamodel)).text, languageIdOf(d.metamodel), uri);
          env.bindings.set(uri.toString(), { engine: b.engine, metamodel: d.metamodel });
        }
        result.push({ uri, range: toMonacoRange(d.target) });
      }
      return result;
    }
  });
}

/** Makes sure the Monaco language of a metamodel exists and highlights the keywords of its current grammar. */
async function prepareLanguage(monaco: MonacoApi, env: Environment, engine: EngineApi, metamodel: string): Promise<string> {
  const id = languageIdOf(metamodel);
  ensureLanguage(monaco, id);
  registerProviders(monaco, env, id);
  const language = (await engine.getComposition())?.languages.find(l => l.name === metamodel);
  if (language) {
    const signature = language.keywords.join('|');
    if (env.tokenizers.get(id)?.keywords !== signature) {
      env.tokenizers.get(id)?.disposable.dispose();
      env.tokenizers.set(id, { keywords: signature, disposable: monaco.languages.setMonarchTokensProvider(id, monarchFor(language.keywords)) });
    }
  }
  return id;
}

/** The text view of an instance: Monaco with highlighting, completion, hover, go-to-definition and live problems. */
export class TextRenderer implements InstanceRenderer {
  private editor?: CodeEditor;
  private host?: HTMLElement;

  constructor(private monaco: MonacoApi, private ctx: RenderContext, private options: TextRendererOptions = {}) {}

  async mount(el: HTMLElement) {
    const { engine, metamodel } = this.ctx;
    const env = environmentOf(this.monaco);
    const language = await prepareLanguage(this.monaco, env, engine, metamodel);
    const uri = modelUri(engine, metamodel);
    env.bindings.set(uri, { engine, metamodel });

    this.host = h('div', { class: 'bango-text-host' });
    el.appendChild(this.host);
    this.editor = new CodeEditor(this.monaco, this.host, {
      uri,
      language,
      debounceMs: this.options.debounceMs,
      theme: this.options.theme,
      fontSize: this.options.fontSize,
      editorOptions: this.options.editorOptions,
      onChange: text => engine.setText(metamodel, text)
    });
  }

  async update(state: InstanceState) {
    if (!this.editor) return;
    const language = await prepareLanguage(this.monaco, environmentOf(this.monaco), this.ctx.engine, this.ctx.metamodel);
    // the view may have been disposed (tab switch) while the language was being prepared
    const editor = this.editor;
    if (!editor) return;
    editor.setLanguage(language);
    editor.setValue(state.text);
    editor.setProblems(state.problems);
  }

  reveal(range: Range0) {
    this.editor?.reveal(range);
  }

  dispose() {
    this.editor?.dispose();
    this.host?.remove();
    this.editor = undefined;
  }
}
