import type * as Monaco from 'monaco-editor/editor/editor.api';
import type { Problem, Range0 } from '@bango/core';
import { javascriptMonarch, langiumMonarch, languageConfiguration } from './monarch.js';

type MonacoApi = typeof Monaco;

const SEVERITY = (m: MonacoApi): Record<Problem['severity'], Monaco.MarkerSeverity> => ({
  error: m.MarkerSeverity.Error,
  warning: m.MarkerSeverity.Warning,
  info: m.MarkerSeverity.Info,
  hint: m.MarkerSeverity.Hint
});

const registered = new WeakMap<object, Set<string>>();

/** Registers a language id (with brackets/comments configuration) once per Monaco instance. Returns true when it was new. */
export function ensureLanguage(monaco: MonacoApi, id: string): boolean {
  let ids = registered.get(monaco);
  if (!ids) registered.set(monaco, (ids = new Set()));
  if (ids.has(id)) return false;
  ids.add(id);
  monaco.languages.register({ id });
  monaco.languages.setLanguageConfiguration(id, languageConfiguration);
  return true;
}

/** `langium` (for metamodels) and `bango-js` (for constraint files). */
export function registerCodeLanguages(monaco: MonacoApi) {
  if (ensureLanguage(monaco, 'langium')) monaco.languages.setMonarchTokensProvider('langium', langiumMonarch);
  if (ensureLanguage(monaco, 'bango-js')) monaco.languages.setMonarchTokensProvider('bango-js', javascriptMonarch);
}

export interface CodeEditorOptions {
  /** one Monaco model per uri keeps undo history and cursor position across switches */
  uri: string;
  language: string;
  value?: string;
  /** called (debounced) with the new text after the user typed */
  onChange?(value: string): void | Promise<unknown>;
  debounceMs?: number;
  theme?: string;
  fontSize?: number;
  editorOptions?: Monaco.editor.IStandaloneEditorConstructionOptions;
}

/**
 * A Monaco editor bound to one text. Local typing is debounced into `onChange`; text pushed in from outside
 * (a form edit, a reset) replaces the content without echoing back and without clobbering unsent typing.
 */
export class CodeEditor {
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly model: Monaco.editor.ITextModel;
  private pending: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private applying = false;
  private inflight = 0;

  constructor(private monaco: MonacoApi, el: HTMLElement, private options: CodeEditorOptions) {
    const uri = monaco.Uri.parse(options.uri);
    this.model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(options.value ?? '', options.language, uri);
    if (options.value !== undefined && this.model.getValue() !== options.value) this.model.setValue(options.value);
    this.editor = monaco.editor.create(el, {
      model: this.model,
      automaticLayout: true,
      minimap: { enabled: false },
      theme: options.theme ?? 'vs-dark',
      fontSize: options.fontSize ?? 13,
      ...options.editorOptions
    });
    // clicking a button elsewhere (Build, say) must not outrun the last keystrokes
    this.editor.onDidBlurEditorText(() => this.flush());
    this.editor.onDidChangeModelContent(() => {
      if (this.applying) return;
      this.pending = this.model.getValue();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), options.debounceMs ?? 250);
    });
  }

  getValue(): string {
    return this.model.getValue();
  }

  /** Replace the content from outside. Ignored while the user has typed something that was not sent or acknowledged yet. */
  setValue(text: string) {
    if (this.pending !== undefined || this.inflight > 0 || this.model.getValue() === text) return;
    this.applying = true;
    try {
      // through the model, not the editor: editor.executeEdits is ignored when the editor is read-only
      this.editor.pushUndoStop();
      this.model.pushEditOperations([], [{ range: this.model.getFullModelRange(), text }], () => null);
      this.editor.pushUndoStop();
    } finally {
      this.applying = false;
    }
  }

  setLanguage(id: string) {
    if (this.model.getLanguageId() !== id) this.monaco.editor.setModelLanguage(this.model, id);
  }

  setProblems(problems: Problem[]) {
    const severity = SEVERITY(this.monaco);
    this.monaco.editor.setModelMarkers(this.model, 'bango', problems.map(p => ({
      severity: severity[p.severity],
      message: p.message,
      startLineNumber: p.startLine + 1,
      startColumn: p.startColumn + 1,
      endLineNumber: p.endLine + 1,
      endColumn: p.endColumn + 1
    })));
  }

  reveal(range: Range0) {
    const r = {
      startLineNumber: range.startLine + 1, startColumn: range.startColumn + 1,
      endLineNumber: range.endLine + 1, endColumn: range.endColumn + 1
    };
    this.editor.setSelection(r);
    this.editor.revealRangeInCenter(r);
    this.editor.focus();
  }

  /** Send unsent typing now. */
  flush() {
    clearTimeout(this.timer);
    const value = this.pending;
    if (value === undefined) return;
    this.pending = undefined;
    // until the receiver has acknowledged this text, an incoming update may still carry an older one
    this.inflight++;
    Promise.resolve(this.options.onChange?.(value))
      .catch(() => { /* the owner reports its own errors */ })
      .finally(() => { this.inflight--; });
  }

  dispose() {
    this.flush();
    this.editor.dispose();
  }
}
