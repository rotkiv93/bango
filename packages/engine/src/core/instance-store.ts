import type { LangiumDocument } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { documentUri, nameOfPath, toAstDto, toProblem, wholeFile, type Composition } from '@bango/composer';
import type { InstanceState, RefCandidate } from '@bango/core';
import { createLanguages, type Language } from './languages.js';

/**
 * The instances of one composition: their texts, one Langium document per metamodel in one shared index (so references can
 * cross metamodels), and the languages they are parsed with. Not queued: callers (the engine) serialise access.
 */
export class InstanceStore {
  composition?: Composition;
  shared?: LangiumSharedServices;
  languages = new Map<string, Language>();
  texts = new Map<string, string>();
  docs = new Map<string, LangiumDocument>();

  /** Switch to a composition. Texts are kept; call `rebuild()` to revalidate them. */
  load(composition: Composition) {
    this.composition = composition;
    const set = createLanguages(composition);
    this.shared = set.shared;
    this.languages = set.languages;
  }

  /** Why a metamodel has no instance document right now. */
  unavailable(metamodel: string): string {
    if (!this.composition) return 'No composition loaded: compose the metamodels first';
    return this.composition.explainUnavailable(metamodel) ?? `No metamodel '${metamodel}'`;
  }

  /** The language of a metamodel; throws with the reason when it is not available. */
  language(metamodel: string): Language {
    const lang = this.languages.get(metamodel);
    if (!lang) throw new Error(this.unavailable(metamodel));
    return lang;
  }

  async setText(metamodel: string, text: string) {
    this.texts.set(metamodel, text);
    await this.rebuild();
  }

  /** The document of a metamodel for `text`, adopting `text` as the instance text first when it differs (live editor text). */
  async docFor(metamodel: string, text: string) {
    const lang = this.language(metamodel);
    if (this.texts.get(metamodel) !== text || !this.docs.has(metamodel)) await this.setText(metamodel, text);
    return { doc: this.docs.get(metamodel)!, lang };
  }

  state(metamodel: string): InstanceState {
    const text = this.texts.get(metamodel) ?? '';
    const doc = this.docs.get(metamodel);
    const lang = this.languages.get(metamodel);
    if (!doc || !lang) return { metamodel, text, problems: [wholeFile('error', this.unavailable(metamodel))], stale: false, available: false };
    return {
      metamodel,
      text,
      ast: toAstDto(doc.parseResult.value),
      problems: (doc.diagnostics ?? []).map(toProblem),
      stale: lang.metamodel.stale,
      available: true
    };
  }

  states(): InstanceState[] {
    return [...this.texts.keys()].map(m => this.state(m));
  }

  /** Every node in the shared index that a reference of `refType` could point to, across all metamodels. */
  candidates(refType: string): RefCandidate[] {
    const index = this.shared?.workspace.IndexManager;
    if (!index) return [];
    return index.allElements(refType).toArray().map(d => ({ name: d.name, type: d.type, metamodel: nameOfPath(d.documentUri.path) }));
  }

  /** Re-creates every instance document so all of them are relinked against fresh content. */
  async rebuild() {
    const shared = this.shared;
    if (!shared) return;
    const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = shared.workspace;
    const old = [...this.docs.values()].map(d => d.uri);
    this.docs.clear();
    // drop previous documents from the shared index first
    if (old.length) await DocumentBuilder.update([], old);
    const docs: LangiumDocument[] = [];
    for (const [metamodel, text] of this.texts) {
      const lang = this.languages.get(metamodel);
      if (!lang) continue; // metamodel not available in this composition
      const doc = LangiumDocumentFactory.fromString(text, documentUri(metamodel, lang.metamodel.extension));
      LangiumDocuments.addDocument(doc);
      this.docs.set(metamodel, doc);
      docs.push(doc);
    }
    await DocumentBuilder.build(docs, { validation: true });
  }
}
