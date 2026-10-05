import type { LangiumDocument } from 'langium';
import { nameOfUri } from '@bango/composer';
import { toRange0, type CompletionDto, type DefinitionDto, type LocationDto, type SymbolDto, type TextEditDto } from '@bango/core';
import type { Language } from './languages.js';

type LspSymbol = Awaited<ReturnType<NonNullable<Language['services']['lsp']['DocumentSymbolProvider']>['getSymbols']>>[number];

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

/** Every reference to the symbol at the position, in every instance of the shared index, and its declaration. */
export async function references(lang: Language, doc: LangiumDocument, line: number, character: number): Promise<LocationDto[]> {
  const locations = await lang.services.lsp.ReferencesProvider?.findReferences(doc, { ...params(doc, line, character), context: { includeDeclaration: true } });
  return (locations ?? []).map(l => ({ metamodel: nameOfUri(l.uri), range: toRange0(l.range) }));
}

export async function symbols(lang: Language, doc: LangiumDocument): Promise<SymbolDto[]> {
  const convert = (s: LspSymbol): SymbolDto => ({
    name: s.name, detail: s.detail, kind: s.kind, range: toRange0(s.range), selectionRange: toRange0(s.selectionRange), children: (s.children ?? []).map(convert)
  });
  const list = await lang.services.lsp.DocumentSymbolProvider?.getSymbols(doc, { textDocument: { uri: doc.uri.toString() } });
  return (list ?? []).map(convert);
}

/** The text of `doc` with `edits` (all of them about this document, positions as in its current text) applied. */
export function applyTextEdits(doc: LangiumDocument, edits: TextEditDto[]): string {
  const at = (line: number, column: number) => doc.textDocument.offsetAt({ line, character: column });
  let text = doc.textDocument.getText();
  // back to front, so an edit does not move the positions of the ones before it
  for (const e of [...edits].sort((a, b) => at(b.range.startLine, b.range.startColumn) - at(a.range.startLine, a.range.startColumn))) {
    text = text.slice(0, at(e.range.startLine, e.range.startColumn)) + e.newText + text.slice(at(e.range.endLine, e.range.endColumn));
  }
  return text;
}

/** The edits that rename the symbol at the position, in every instance that mentions it. `error` when there is nothing to rename there. */
export async function renameEdits(lang: Language, doc: LangiumDocument, line: number, character: number, newName: string): Promise<{ edits: TextEditDto[]; error?: string }> {
  const provider = lang.services.lsp.RenameProvider;
  if (!provider || !(await provider.prepareRename(doc, params(doc, line, character)))) return { edits: [], error: 'There is nothing to rename here' };
  const workspaceEdit = await provider.rename(doc, { ...params(doc, line, character), newName });
  const edits: TextEditDto[] = [];
  for (const [uri, changes] of Object.entries(workspaceEdit?.changes ?? {})) {
    for (const c of changes) edits.push({ metamodel: nameOfUri(uri), range: toRange0(c.range), newText: c.newText });
  }
  return { edits };
}
