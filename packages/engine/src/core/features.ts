import type { LangiumDocument } from 'langium';
import type { CompletionDto, DefinitionDto, Range0 } from '@bango/core';
import type { Language } from './languages.js';
import { metamodelOfPath } from '@bango/composer';

const toRange = (r: { start: { line: number; character: number }; end: { line: number; character: number } }): Range0 => ({
  startLine: r.start.line, startColumn: r.start.character, endLine: r.end.line, endColumn: r.end.character
});

const params = (doc: LangiumDocument, line: number, character: number) => ({
  textDocument: { uri: doc.uri.toString() },
  position: { line, character }
});

/** Editor features: Langium's LSP providers, reduced to plain data. */
export async function complete(lang: Language, doc: LangiumDocument, line: number, character: number): Promise<CompletionDto[]> {
  const list = await lang.services.lsp.CompletionProvider?.getCompletion(doc, params(doc, line, character));
  return (list?.items ?? []).map(item => {
    const edit = item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined;
    return {
      label: item.label,
      detail: item.detail,
      kind: item.kind,
      insertText: edit?.newText ?? item.insertText ?? item.label,
      range: edit ? toRange(edit.range) : undefined
    };
  });
}

export async function hover(lang: Language, doc: LangiumDocument, line: number, character: number): Promise<string | undefined> {
  const result = await lang.services.lsp.HoverProvider?.getHoverContent(doc, params(doc, line, character));
  const c = result?.contents;
  if (!c) return undefined;
  if (typeof c === 'string') return c;
  if ('value' in c) return c.value;
  return c.map(x => (typeof x === 'string' ? x : x.value)).join('\n\n');
}

export async function definition(lang: Language, doc: LangiumDocument, line: number, character: number): Promise<DefinitionDto[]> {
  const links = await lang.services.lsp.DefinitionProvider?.getDefinition(doc, params(doc, line, character));
  return (links ?? []).map(l => ({
    metamodel: metamodelOfPath(l.targetUri.replace(/^memory:/, '')),
    target: toRange(l.targetSelectionRange)
  }));
}
