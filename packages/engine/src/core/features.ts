import type { LangiumDocument } from 'langium';
import { nameOfUri } from '@bango/composer';
import { toRange0, type CompletionDto, type DefinitionDto } from '@bango/core';
import type { Language } from './languages.js';

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
      range: edit ? toRange0(edit.range) : undefined
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
  return (links ?? []).map(l => ({ metamodel: nameOfUri(l.targetUri), target: toRange0(l.targetSelectionRange) }));
}
