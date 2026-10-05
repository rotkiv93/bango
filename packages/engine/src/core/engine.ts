import { URI, type LangiumDocument } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { metamodelOfPath, toAstDto, toProblem, wholeFile, type Composition, type CompositionInfo } from '@bango/composer';
import { buildModel } from './build.js';
import { mergeJson, toJsonSpec } from '../json/json-spec.js';
import * as features from './features.js';
import { applyEditToText, defaultDto } from '../forms/edits.js';
import { Printer } from '../forms/printer.js';
import { buildFormSchema, indexRules } from '../forms/schema.js';
import { createLanguages, type Language } from './languages.js';
import type {
  BuildResult,
  CompletionDto,
  DefinitionDto,
  EditOp,
  EngineApi,
  EngineEvent,
  FormSchema,
  InstanceState,
  JsonSpecOptions,
  JsonValue,
  RefCandidate,
  Unsubscribe
} from '../types.js';

/**
 * Parses, links, validates and edits the instances of a composition: one document per metamodel,
 * all in one shared Langium index so references can cross metamodels.
 *
 * Every public method is async and runs one at a time, so callers can fire edits without coordinating.
 */
export class ModelEngine implements EngineApi {
  private composition?: Composition;
  private shared?: LangiumSharedServices;
  private languages = new Map<string, Language>();
  private texts = new Map<string, string>();
  private docs = new Map<string, LangiumDocument>();
  private listeners = new Set<(event: EngineEvent) => void>();
  private chain: Promise<unknown> = Promise.resolve();

  /** Load a composition. Instance texts are kept and revalidated against the new languages. */
  use(composition: Composition): Promise<void> {
    return this.run(async () => {
      this.composition = composition;
      const set = createLanguages(composition);
      this.shared = set.shared;
      this.languages = set.languages;
      await this.rebuild();
      this.emit({ type: 'composition' });
    });
  }

  // --------------------------------------------------------------- instances

  getInstance(metamodel: string): Promise<InstanceState> {
    return this.run(async () => this.state(metamodel));
  }

  getInstances(): Promise<InstanceState[]> {
    return this.run(async () => [...this.texts.keys()].map(m => this.state(m)));
  }

  getComposition(): Promise<CompositionInfo | undefined> {
    return this.run(async () => this.composition?.info());
  }

  setText(metamodel: string, text: string): Promise<InstanceState> {
    return this.run(() => this.setTextNow(metamodel, text));
  }

  setInstances(texts: Record<string, string>): Promise<InstanceState[]> {
    return this.run(async () => {
      this.texts = new Map(Object.entries(texts));
      await this.rebuild();
      this.emit({ type: 'instances' });
      return [...this.texts.keys()].map(m => this.state(m));
    });
  }

  createInstance(metamodel: string): Promise<InstanceState> {
    return this.run(async () => {
      if (this.texts.has(metamodel)) return this.state(metamodel);
      const lang = this.languages.get(metamodel);
      if (!lang) throw new Error(this.composition?.explainUnavailable(metamodel) ?? `No metamodel '${metamodel}'`);
      const schema = buildFormSchema(lang.metamodel.grammar, lang.metamodel.reflection);
      const root = defaultDto(schema.root, schema, t => this.candidates(t));
      const text = new Printer(indexRules(lang.metamodel.grammar)).print(root, 0) + '\n';
      return this.setTextNow(metamodel, text);
    });
  }

  removeInstance(metamodel: string): Promise<void> {
    return this.run(async () => {
      this.texts.delete(metamodel);
      await this.rebuild();
      this.emit({ type: 'instance', metamodel });
    });
  }

  // ---------------------------------------------------------------- forms

  getFormSchema(metamodel: string): Promise<FormSchema | undefined> {
    return this.run(async () => {
      const lang = this.languages.get(metamodel);
      return lang && buildFormSchema(lang.metamodel.grammar, lang.metamodel.reflection);
    });
  }

  /** The instance as plain JSON: its configuration without parser details. Undefined when it cannot be parsed or is not available. */
  toJson(metamodel: string, options?: JsonSpecOptions): Promise<JsonValue | undefined> {
    return this.run(async () => this.specOf(metamodel, options ?? {}));
  }

  /** The whole project as JSON: the specs of the metamodels that have a JSON mapping, merged into one document. */
  toProjectJson(options?: JsonSpecOptions): Promise<JsonValue> {
    return this.run(async () => this.projectJson(options ?? {}));
  }

  /** Every node in the shared index that a reference of `refType` could point to, across all metamodels. */
  getRefCandidates(refType: string): Promise<RefCandidate[]> {
    return this.run(async () => this.candidates(refType));
  }

  /** Applies a form/diagram edit to the instance text, then re-parses it. */
  applyEdit(metamodel: string, op: EditOp): Promise<InstanceState> {
    return this.run(async () => {
      const { doc, lang } = await this.docFor(metamodel, this.texts.get(metamodel) ?? '');
      const text = applyEditToText(
        {
          text: this.texts.get(metamodel) ?? '',
          doc,
          grammar: lang.metamodel.grammar,
          reflection: lang.metamodel.reflection,
          refCandidates: t => this.candidates(t)
        },
        op
      );
      return this.setTextNow(metamodel, text);
    });
  }

  // ------------------------------------------------------- editor features
  // These carry the live text of the editor, which may be newer than the last debounced `setText`.
  // The engine adopts that text as the instance text first, so the editor and the engine never disagree.

  complete(metamodel: string, text: string, line: number, column: number): Promise<CompletionDto[]> {
    return this.run(async () => {
      const found = await this.tryDocFor(metamodel, text);
      return found ? features.complete(found.lang, found.doc, line, column) : [];
    });
  }

  hover(metamodel: string, text: string, line: number, column: number): Promise<string | undefined> {
    return this.run(async () => {
      const found = await this.tryDocFor(metamodel, text);
      return found ? features.hover(found.lang, found.doc, line, column) : undefined;
    });
  }

  definition(metamodel: string, text: string, line: number, column: number): Promise<DefinitionDto[]> {
    return this.run(async () => {
      const found = await this.tryDocFor(metamodel, text);
      return found ? features.definition(found.lang, found.doc, line, column) : [];
    });
  }

  // ------------------------------------------------------------------ build

  /** The final model of the project, or the reasons it cannot be built. */
  build(project: string): Promise<BuildResult> {
    return this.run(async () => {
      if (!this.composition) return { ok: false, errors: ['No composition loaded'], warnings: [] };
      const states = [...this.texts.keys()].map(m => this.state(m));
      const specs = new Map<string, JsonValue>();
      const errors: string[] = [];
      for (const s of states) {
        if (!s.available || !s.ast) continue;
        try { specs.set(s.metamodel, this.specOf(s.metamodel, {})!); } catch (e) { errors.push(`${s.metamodel}: ${(e as Error).message}`); }
      }
      let merged: JsonValue = {};
      try { merged = this.projectJson({}); } catch (e) { errors.push((e as Error).message); }
      return buildModel(project, this.composition, states, { specs, merged, errors });
    });
  }

  // ----------------------------------------------------------------- events

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose() {
    this.listeners.clear();
  }

  // -------------------------------------------------------------- internals

  /** Serialises public calls: Langium's document builder cannot run two rebuilds of one index at once. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private emit(event: EngineEvent) {
    for (const l of [...this.listeners]) {
      try { l(event); } catch { /* a faulty listener must not break the engine */ }
    }
  }

  private async setTextNow(metamodel: string, text: string): Promise<InstanceState> {
    this.texts.set(metamodel, text);
    await this.rebuild();
    this.emit({ type: 'instance', metamodel });
    return this.state(metamodel);
  }

  private async tryDocFor(metamodel: string, text: string) {
    if (!this.languages.has(metamodel)) return undefined;
    return this.docFor(metamodel, text);
  }

  private async docFor(metamodel: string, text: string) {
    const lang = this.languages.get(metamodel);
    if (!lang) throw new Error(this.composition?.explainUnavailable(metamodel) ?? `No metamodel '${metamodel}'`);
    if (this.texts.get(metamodel) !== text || !this.docs.has(metamodel)) {
      this.texts.set(metamodel, text);
      await this.rebuild();
    }
    return { doc: this.docs.get(metamodel)!, lang };
  }

  /** An instance as JSON: its metamodel's own mapping when it has one (and `format` is not `generic`), else the generic tree. */
  private specOf(metamodel: string, options: JsonSpecOptions): JsonValue | undefined {
    const doc = this.docs.get(metamodel);
    const lang = this.languages.get(metamodel);
    if (!doc || !lang) return undefined;
    const spec = options.format === 'generic' ? undefined : lang.metamodel.spec;
    if (!spec) {
      const ast = this.state(metamodel).ast;
      return ast ? toJsonSpec(ast, options) : undefined;
    }
    try {
      const refName = (ref: unknown): string | undefined => {
        const r = ref as { ref?: { name?: unknown }; $refText?: string } | undefined;
        return typeof r?.ref?.name === 'string' ? r.ref.name : r?.$refText;
      };
      // through JSON, so what comes out is guaranteed to be plain data
      return JSON.parse(JSON.stringify(spec(doc.parseResult.value, { refName }) ?? null)) as JsonValue;
    } catch (e) {
      throw new Error(`The JSON mapping of '${metamodel}' failed: ${(e as Error).message}`);
    }
  }

  private projectJson(options: JsonSpecOptions): JsonValue {
    const metamodels = [...this.texts.keys()].filter(m => this.docs.has(m));
    if (options.format === 'generic' || options.merge === false) {
      return Object.fromEntries(metamodels.map(m => [m, this.specOf(m, options)!]));
    }
    // metamodels without a JSON mapping have no place in the merged document. The mapping that lays out the
    // document (`root: true`) goes first, so its key order becomes the order of the merged document.
    const meta = (m: string) => this.languages.get(m)!.metamodel;
    const parts = metamodels
      .filter(m => this.languages.get(m)?.metamodel.spec)
      // the root mapping first (it lays out the document), then the ones that need more before the ones that need less
      .sort((a, b) => Number(!!meta(b).specRoot) - Number(!!meta(a).specRoot) || meta(b).requires.length - meta(a).requires.length)
      .map(m => this.specOf(m, options)!);
    return mergeJson(...parts);
  }

  private candidates(refType: string): RefCandidate[] {
    const index = this.shared?.workspace.IndexManager;
    if (!index) return [];
    return index.allElements(refType).toArray().map(d => ({
      name: d.name,
      type: d.type,
      metamodel: metamodelOfPath(d.documentUri.path)
    }));
  }

  private state(metamodel: string): InstanceState {
    const text = this.texts.get(metamodel) ?? '';
    const doc = this.docs.get(metamodel);
    const lang = this.languages.get(metamodel);
    if (!doc || !lang) {
      const why = this.composition?.explainUnavailable(metamodel) ?? 'No composition loaded: compose the metamodels first';
      return { metamodel, text, problems: [wholeFile('error', why)], stale: false, available: false };
    }
    return {
      metamodel,
      text,
      ast: toAstDto(doc.parseResult.value),
      problems: (doc.diagnostics ?? []).map(toProblem),
      stale: lang.metamodel.stale,
      available: true
    };
  }

  /** Re-creates every instance document so all of them are relinked against fresh content. */
  private async rebuild() {
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
      const doc = LangiumDocumentFactory.fromString(text, URI.parse(`memory:/${metamodel}.${lang.metamodel.extension}`));
      LangiumDocuments.addDocument(doc);
      this.docs.set(metamodel, doc);
      docs.push(doc);
    }
    await DocumentBuilder.build(docs, { validation: true });
  }
}
