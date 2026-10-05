import { AstUtils, EmptyFileSystem, type Grammar, type LangiumDocument, type LangiumDocuments } from 'langium';
import { createLangiumGrammarServices, resolveImportUri, resolveTransitiveImports } from 'langium/grammar';
import type { GrammarInfo } from '@bango/core';
import { hasEntryRule } from '../grammar/flatten.js';
import { documentUri, nameOfDocument, nameOfPath } from '../model/documents.js';
import { toProblem, wholeFile } from '../model/problems.js';

/** The grammars of a workspace, parsed and validated, with what the outside world is told about each. */
export interface Build {
  docs: Map<string, LangiumDocument<Grammar>>;
  documents: LangiumDocuments;
  infos: GrammarInfo[];
}

/** The first non-empty `//` comment line: the author's one-line description of the metamodel. */
function describeGrammar(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const m = /^\s*\/\/\s?(.*)$/.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return undefined;
}

/**
 * Parse and validate `texts` (grammar name -> text) in a fresh grammar workspace: grammars are small, and a fresh one on
 * every change keeps import resolution trivial. `authored` are the texts the user wrote, which `texts` may rewrite.
 */
export async function buildWorkspace(texts: Map<string, string>, authored: Map<string, string> = texts): Promise<Build> {
  const { shared } = createLangiumGrammarServices(EmptyFileSystem).grammar;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
  const parsed = [...texts].map(([name, text]) => LangiumDocumentFactory.fromString<Grammar>(text, documentUri(name, 'langium')));
  parsed.forEach(d => LangiumDocuments.addDocument(d));
  await DocumentBuilder.build(parsed, { validation: true });

  const infos: GrammarInfo[] = [];
  for (const doc of parsed) {
    const grammar = doc.parseResult.value;
    const name = nameOfDocument(doc);
    const isMetamodel = hasEntryRule(grammar);
    infos.push({
      name,
      extension: isMetamodel ? (grammar.name ?? name).toLowerCase() : undefined,
      description: describeGrammar(authored.get(name) ?? ''),
      imports: grammar.imports.map(i => resolveImportUri(i)).filter(uri => !!uri).map(uri => nameOfPath(uri.path)),
      requires: isMetamodel
        ? resolveTransitiveImports(LangiumDocuments, grammar).filter(hasEntryRule).map(g => nameOfDocument(AstUtils.getDocument(g)))
        : [],
      // grammars without an entry rule are libraries (e.g. shared terminals), not metamodels
      problems: (doc.diagnostics ?? []).map(toProblem).filter(p => isMetamodel || !/missing an entry parser rule/.test(p.message))
    });
  }

  // the language registry maps one file extension to one language
  const byExtension = new Map<string, GrammarInfo[]>();
  for (const i of infos) if (i.extension) byExtension.set(i.extension, [...(byExtension.get(i.extension) ?? []), i]);
  for (const [ext, list] of byExtension) {
    if (list.length < 2) continue;
    for (const i of list) {
      i.problems.push(wholeFile('error', `Extension '.${ext}' is also used by ${list.filter(x => x !== i).map(x => x.name).join(', ')}: grammar names must be unique`));
    }
  }

  return { docs: new Map(parsed.map(d => [nameOfDocument(d), d])), documents: LangiumDocuments, infos };
}

/** The grammar files a grammar imports, transitively. */
export function importsOf(build: Build, name: string): string[] {
  const doc = build.docs.get(name);
  return doc ? resolveTransitiveImports(build.documents, doc.parseResult.value).map(g => nameOfDocument(AstUtils.getDocument(g))) : [];
}

/** The grammar files a metamodel includes: its own and everything it imports. */
export const filesOf = (build: Build, name: string): string[] => (build.docs.has(name) ? [name, ...importsOf(build, name)] : []);

/** Add a problem about a whole grammar, by its name. */
export function report(infos: GrammarInfo[], name: string, severity: 'error' | 'info', message: string) {
  infos.find(g => g.name === name)?.problems.push(wholeFile(severity, message));
}

/** A copy of the infos that callers may change. */
export const copyInfos = (infos: GrammarInfo[]): GrammarInfo[] => infos.map(i => ({ ...i, requires: [...i.requires], problems: [...i.problems] }));
