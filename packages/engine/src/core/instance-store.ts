import type { AstNode, LangiumDocument, Reference } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { documentUri, nameOfPath, toAstDto, toProblem, wholeFile, type Composition } from '@bango/composer';
import type { InstanceState, RefCandidate } from '@bango/core';
import { History } from './history.js';
import { createLanguages, type Language } from './languages.js';
import { MetamodelScopeProvider } from './scope.js';

/** Why a text could not be read, in words: a parser that ran out of stack says "Maximum call stack size exceeded", which is a text nested too deeply. */
const reasonOf = (e: unknown) => (e instanceof RangeError ? 'it is nested too deeply' : (e as Error)?.message ?? String(e));

/** How big an instance may be (characters). Every keystroke parses it again, so beyond this it is reported instead of read. */
const DEFAULT_MAX_INSTANCE_CHARS = 2_000_000;

/**
 * The instances of one composition: their texts, one Langium document per metamodel in one shared index (so references can
 * cross metamodels), and the languages they are parsed with. Not queued: callers (the engine) serialise access.
 */
export class InstanceStore {
  /**
   * Remake only the documents a change can have touched. Turning it off remakes all of them every time (what this used to do): slower,
   * and the reference the incremental way is checked against in the tests.
   */
  constructor(private readonly options: { incremental?: boolean; maxInstanceChars?: number } = {}) {}

  private get maxInstanceChars() {
    return this.options.maxInstanceChars ?? DEFAULT_MAX_INSTANCE_CHARS;
  }

  /** Instances whose text could not be read at all (a parser that ran out of stack on a text nested too deeply), and why. */
  private unreadable = new Map<string, string>();

  /** The text of an instance is over the limit: it is kept (the editor still shows it) but not parsed. */
  tooLarge(metamodel: string): boolean {
    return (this.texts.get(metamodel)?.length ?? 0) > this.maxInstanceChars;
  }

  composition?: Composition;
  shared?: LangiumSharedServices;
  languages = new Map<string, Language>();
  texts = new Map<string, string>();
  docs = new Map<string, LangiumDocument>();
  history = new History();

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

  /**
   * Change one instance's text. `typing`: it comes from an editor, so changes in quick succession are one step of history.
   * The same text again changes nothing, and costs nothing.
   */
  async setText(metamodel: string, text: string, typing = false) {
    if (this.texts.get(metamodel) === text && (this.docs.has(metamodel) || !this.languages.has(metamodel))) return;
    this.remember(metamodel, text, typing);
    this.texts.set(metamodel, text);
    await this.rebuild([metamodel]);
  }

  /** Change several instances with one rebuild (a rename that reaches into other instances, say). */
  async setTexts(changes: Map<string, string>) {
    for (const [metamodel, text] of changes) {
      this.remember(metamodel, text, false);
      this.texts.set(metamodel, text);
    }
    await this.rebuild([...changes.keys()]);
  }

  /** Put a text back (undo, redo): what history keeps is already in order, so nothing is recorded. */
  async restore(metamodel: string, text: string) {
    this.texts.set(metamodel, text);
    await this.rebuild([metamodel]);
  }

  private remember(metamodel: string, text: string, typing: boolean) {
    const before = this.texts.get(metamodel);
    if (before !== undefined && before !== text) this.history.record(metamodel, before, typing);
  }

  /** The document of a metamodel for `text`, adopting `text` as the instance text first when it differs (live editor text). */
  async docFor(metamodel: string, text: string) {
    const lang = this.language(metamodel);
    if (this.texts.get(metamodel) !== text || !this.docs.has(metamodel)) await this.setText(metamodel, text, true);
    return { doc: this.docs.get(metamodel)!, lang };
  }

  state(metamodel: string): InstanceState {
    const text = this.texts.get(metamodel) ?? '';
    const doc = this.docs.get(metamodel);
    const lang = this.languages.get(metamodel);
    if (lang && !doc && this.unreadable.has(metamodel)) {
      return { metamodel, text, problems: [wholeFile('error', `This text could not be read: ${this.unreadable.get(metamodel)}`)], stale: lang.metamodel.stale, available: true };
    }
    if (lang && !doc && this.tooLarge(metamodel)) {
      const limit = (this.maxInstanceChars / 1_000_000).toFixed(1);
      return { metamodel, text, problems: [wholeFile('error', `This text is ${(text.length / 1_000_000).toFixed(1)} million characters, over the limit of ${limit} million: it is not read. Split it, or raise the limit (maxInstanceChars).`)], stale: lang.metamodel.stale, available: true };
    }
    if (!doc || !lang) return { metamodel, text, problems: [wholeFile('error', this.unavailable(metamodel))], stale: false, available: false };
    return {
      metamodel,
      text,
      ast: toAstDto(doc.parseResult.value),
      problems: (doc.diagnostics ?? []).map(toProblem),
      stale: lang.metamodel.stale,
      available: true,
      canUndo: this.history.canUndo(metamodel),
      canRedo: this.history.canRedo(metamodel)
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

  /** Whether a scope script has a say about this reference feature of this node type, in the metamodel. */
  scopeDecides(metamodel: string, type: string, feature: string): boolean {
    const provider = this.languages.get(metamodel)?.services.references.ScopeProvider;
    return provider instanceof MetamodelScopeProvider && provider.decides(type, feature);
  }

  /**
   * The nodes a reference of `refType` can point to *from where it is written*: the node that holds it, and the feature. What the scope
   * scripts of the metamodel say, when they decide; every node of the type otherwise. (`node` may be one that is only about to be
   * created: a `$type` and the `$container` it will be in are enough for a scope script that looks at its surroundings.)
   */
  candidatesAt(metamodel: string, node: { $type: string; $container?: unknown; $containerProperty?: string }, feature: string, refType: string): RefCandidate[] {
    const provider = this.languages.get(metamodel)?.services.references.ScopeProvider;
    if (!(provider instanceof MetamodelScopeProvider) || !provider.decides(node.$type, feature)) return this.candidates(refType);
    try {
      const scope = provider.getScope({ container: node as AstNode, property: feature, reference: { $refText: '' } as Reference });
      return scope.getAllElements().toArray().map(d => ({ name: d.name, type: d.type, metamodel: nameOfPath(d.documentUri.path) }));
    } catch {
      return []; // a scope script that fails offers nothing: the problem shows when the instance is checked
    }
  }

  /**
   * The metamodels whose documents must be made again when the instances of `changed` changed: those, and every metamodel that needs one
   * of them (`requires` already holds everything it imports, directly or not). A document of any other metamodel cannot refer to what
   * changed, so what it says, and what is said about it, stays true.
   */
  private affectedBy(changed: string[]): Set<string> {
    const affected = new Set(changed);
    for (const [name, lang] of this.languages) {
      if (lang.metamodel.requires.some(r => changed.includes(r))) affected.add(name);
    }
    return affected;
  }

  /**
   * Makes the instance documents again so they are linked against fresh content: all of them, or (given `changed`, the metamodels whose
   * text was just changed or removed) only the ones that change can have reached.
   */
  async rebuild(changed?: string[]) {
    const shared = this.shared;
    if (!shared) return;
    const only = changed && this.options.incremental !== false ? this.affectedBy(changed) : undefined;
    const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = shared.workspace;
    const stale = [...this.docs].filter(([metamodel]) => !only || only.has(metamodel));
    for (const [metamodel] of stale) this.docs.delete(metamodel);
    // drop the documents that are made again from the shared index first
    if (stale.length) await DocumentBuilder.update([], stale.map(([, d]) => d.uri));
    const docs: LangiumDocument[] = [];
    for (const [metamodel, text] of this.texts) {
      if (only && !only.has(metamodel)) continue;
      this.unreadable.delete(metamodel);
      if (this.tooLarge(metamodel)) continue;
      const lang = this.languages.get(metamodel);
      if (!lang) continue; // metamodel not available in this composition
      let doc: LangiumDocument;
      try {
        doc = LangiumDocumentFactory.fromString(text, documentUri(metamodel, lang.metamodel.extension));
      } catch (e) {
        // the parser itself gave up (its stack is only so deep): that is a problem of this text, not a reason to fail the call
        this.unreadable.set(metamodel, reasonOf(e));
        continue;
      }
      LangiumDocuments.addDocument(doc);
      this.docs.set(metamodel, doc);
      docs.push(doc);
    }
    try {
      await DocumentBuilder.build(docs, { validation: true });
    } catch (e) {
      // linking or checking ran out of stack on one of them: they are left out, one by one, until what remains builds
      for (const doc of docs) this.unreadable.set(nameOfPath(doc.uri.path), reasonOf(e));
      for (const doc of docs) this.docs.delete(nameOfPath(doc.uri.path));
      try { await DocumentBuilder.update([], docs.map(d => d.uri)); } catch { /* the index is rebuilt with the next change */ }
    }
  }
}
