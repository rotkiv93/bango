import type * as Monaco from 'monaco-editor/editor/editor.api';
import type { EngineApi, InstanceState, QuickFix, Range0, SymbolDto } from '@bango/core';
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
  commandRegistered: boolean;
}

const environments = new WeakMap<object, Environment>();
const engineIds = new WeakMap<object, number>();
let nextEngineId = 0;

function environmentOf(monaco: MonacoApi): Environment {
  let env = environments.get(monaco);
  if (!env) environments.set(monaco, (env = { bindings: new Map(), tokenizers: new Map(), providers: new Set(), commandRegistered: false }));
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

/** The command a quick fix runs: the fix is plain data, so it carries the engine that knows how to apply it. */
const APPLY_QUICK_FIX = 'bango.applyQuickFix';

/** LSP symbol kinds count from 1, Monaco's from 0. */
function toMonacoSymbol(s: SymbolDto): Monaco.languages.DocumentSymbol {
  return {
    name: s.name, detail: s.detail ?? '', kind: s.kind - 1, tags: [], range: toMonacoRange(s.range), selectionRange: toMonacoRange(s.selectionRange),
    children: s.children.map(toMonacoSymbol)
  };
}

function registerProviders(monaco: MonacoApi, env: Environment, language: string) {
  if (env.providers.has(language)) return;
  env.providers.add(language);
  const bindingOf = (model: Monaco.editor.ITextModel) => env.bindings.get(model.uri.toString());

  if (!env.commandRegistered) {
    env.commandRegistered = true;
    monaco.editor.registerCommand(APPLY_QUICK_FIX, (_accessor, engine: EngineApi, fix: QuickFix) => engine.applyQuickFix(fix));
  }

  /** The Monaco model that shows an instance, made on the spot when it is not open in an editor (so a jump or a reference can land in it). */
  const modelFor = async (binding: Binding, metamodel: string) => {
    const uri = monaco.Uri.parse(modelUri(binding.engine, metamodel));
    if (!monaco.editor.getModel(uri)) {
      monaco.editor.createModel((await binding.engine.getInstance(metamodel)).text, languageIdOf(metamodel), uri);
      env.bindings.set(uri.toString(), { engine: binding.engine, metamodel });
    }
    return uri;
  };

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
      return Promise.all(defs.map(async d => ({ uri: await modelFor(b, d.metamodel), range: toMonacoRange(d.target) })));
    }
  });

  monaco.languages.registerReferenceProvider(language, {
    async provideReferences(model, position) {
      const b = bindingOf(model);
      if (!b) return [];
      const found = await b.engine.references(b.metamodel, model.getValue(), position.lineNumber - 1, position.column - 1);
      return Promise.all(found.map(async l => ({ uri: await modelFor(b, l.metamodel), range: toMonacoRange(l.range) })));
    }
  });

  monaco.languages.registerDocumentSymbolProvider(language, {
    displayName: 'Bango',
    async provideDocumentSymbols(model) {
      const b = bindingOf(model);
      return b ? (await b.engine.symbols(b.metamodel, model.getValue())).map(toMonacoSymbol) : [];
    }
  });

  monaco.languages.registerRenameProvider(language, {
    async provideRenameEdits(model, position, newName) {
      const b = bindingOf(model);
      if (!b) return { edits: [] };
      const result = await b.engine.rename(b.metamodel, model.getValue(), position.lineNumber - 1, position.column - 1, newName);
      if (result.error) return { edits: [], rejectReason: result.error };
      // the engine has changed the other instances; this editor applies its own part, as it would any edit
      return {
        edits: result.edits.filter(e => e.metamodel === b.metamodel).map(e => ({
          resource: model.uri, versionId: undefined, textEdit: { range: toMonacoRange(e.range), text: e.newText }
        }))
      };
    }
  });

  monaco.languages.registerCodeActionProvider(language, {
    async provideCodeActions(model, range) {
      const b = bindingOf(model);
      if (!b) return { actions: [], dispose() {} };
      const start = range.getStartPosition();
      const fixes = await b.engine.quickFixes(b.metamodel, model.getValue(), start.lineNumber - 1, start.column - 1);
      return {
        actions: fixes.map(fix => ({
          title: fix.title,
          kind: 'quickfix',
          isPreferred: true,
          command: { id: APPLY_QUICK_FIX, title: fix.title, arguments: [b.engine, fix] }
        })),
        dispose() {}
      };
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
