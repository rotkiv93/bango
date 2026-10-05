import type { LangiumDocument } from 'langium';
import type { Composition, CompositionInfo } from '@bango/composer';
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
  LocationDto,
  QuickFix,
  RefCandidate,
  RenameResult,
  SymbolDto,
  Unsubscribe
} from '@bango/core';
import { applyEditToText, defaultDto } from '../editing/edits.js';
import { Printer } from '../editing/printer.js';
import { buildFormSchema, indexRules } from '../editing/schema.js';
import { buildModel } from './build.js';
import { EventBus } from './event-bus.js';
import * as features from './features.js';
import { InstanceStore } from './instance-store.js';
import { projectJson, specOf } from './json-views.js';
import { applyQuickFix, quickFixes } from './quick-fixes.js';
import type { Language } from './languages.js';
import { SerialQueue } from './serial-queue.js';

/**
 * Parses, links, validates and edits the instances of a composition: one document per metamodel,
 * all in one shared Langium index so references can cross metamodels.
 *
 * Every public method is async and runs one at a time, so callers can fire edits without coordinating.
 */
export class ModelEngine implements EngineApi {
  private store = new InstanceStore();
  private queue = new SerialQueue();
  private events = new EventBus();

  /** Load a composition. Instance texts are kept and revalidated against the new languages. */
  use(composition: Composition): Promise<void> {
    return this.queue.run(async () => {
      this.store.load(composition);
      await this.store.rebuild();
      this.events.emit({ type: 'composition' });
    });
  }

  // --------------------------------------------------------------- instances

  getInstance(metamodel: string): Promise<InstanceState> {
    return this.queue.run(() => this.store.state(metamodel));
  }

  getInstances(): Promise<InstanceState[]> {
    return this.queue.run(() => this.store.states());
  }

  getComposition(): Promise<CompositionInfo | undefined> {
    return this.queue.run(() => this.store.composition?.info());
  }

  setText(metamodel: string, text: string): Promise<InstanceState> {
    return this.queue.run(() => this.setTextNow(metamodel, text, true));
  }

  setInstances(texts: Record<string, string>): Promise<InstanceState[]> {
    return this.queue.run(async () => {
      this.store.texts = new Map(Object.entries(texts));
      this.store.history.clear();
      await this.store.rebuild();
      this.events.emit({ type: 'instances' });
      return this.store.states();
    });
  }

  createInstance(metamodel: string): Promise<InstanceState> {
    return this.queue.run(() => this.createInstanceNow(metamodel));
  }

  removeInstance(metamodel: string): Promise<void> {
    return this.queue.run(async () => {
      this.store.texts.delete(metamodel);
      this.store.history.clear(metamodel);
      await this.store.rebuild();
      this.events.emit({ type: 'instance', metamodel });
    });
  }

  // ---------------------------------------------------------------- forms

  getFormSchema(metamodel: string): Promise<FormSchema | undefined> {
    return this.queue.run(() => {
      const lang = this.store.languages.get(metamodel);
      return lang && buildFormSchema(lang.metamodel.grammar, lang.metamodel.reflection);
    });
  }

  /** The instance as plain JSON: its configuration without parser details. Undefined when it cannot be parsed or is not available. */
  toJson(metamodel: string, options?: JsonSpecOptions): Promise<JsonValue | undefined> {
    return this.queue.run(() => specOf(this.store, metamodel, options ?? {}));
  }

  /** The whole project as JSON: the specs of the metamodels that have a JSON mapping, merged into one document. */
  toProjectJson(options?: JsonSpecOptions): Promise<JsonValue> {
    return this.queue.run(() => projectJson(this.store, options ?? {}));
  }

  /** Every node in the shared index that a reference of `refType` could point to, across all metamodels. */
  getRefCandidates(refType: string): Promise<RefCandidate[]> {
    return this.queue.run(() => this.store.candidates(refType));
  }

  /** Applies a form/diagram edit to the instance text, then re-parses it. */
  applyEdit(metamodel: string, op: EditOp): Promise<InstanceState> {
    return this.queue.run(() => this.applyEditNow(metamodel, op));
  }

  // ------------------------------------------------------- editor features
  // These carry the live text of the editor, which may be newer than the last debounced `setText`.
  // The engine adopts that text as the instance text first, so the editor and the engine never disagree.

  complete(metamodel: string, text: string, line: number, column: number): Promise<CompletionDto[]> {
    return this.withLiveDoc(metamodel, text, [], (lang, doc) => features.complete(lang, doc, line, column));
  }

  hover(metamodel: string, text: string, line: number, column: number): Promise<string | undefined> {
    return this.withLiveDoc(metamodel, text, undefined, (lang, doc) => features.hover(lang, doc, line, column));
  }

  definition(metamodel: string, text: string, line: number, column: number): Promise<DefinitionDto[]> {
    return this.withLiveDoc(metamodel, text, [], (lang, doc) => features.definition(lang, doc, line, column));
  }

  references(metamodel: string, text: string, line: number, column: number): Promise<LocationDto[]> {
    return this.withLiveDoc(metamodel, text, [], (lang, doc) => features.references(lang, doc, line, column));
  }

  symbols(metamodel: string, text: string): Promise<SymbolDto[]> {
    return this.withLiveDoc(metamodel, text, [], (lang, doc) => features.symbols(lang, doc));
  }

  rename(metamodel: string, text: string, line: number, column: number, newName: string): Promise<RenameResult> {
    return this.queue.run(async () => {
      if (!this.store.languages.has(metamodel)) return { edits: [], applied: [], error: this.store.unavailable(metamodel) };
      if (!newName.trim()) return { edits: [], applied: [], error: 'The new name is empty' };
      const { lang, doc } = await this.store.docFor(metamodel, text);
      const { edits, error } = await features.renameEdits(lang, doc, line, column, newName);
      if (error) return { edits: [], applied: [], error };
      // The asking instance is left to its editor (it holds the live text); every other instance changes here, in one rebuild.
      const changes = new Map<string, string>();
      for (const other of new Set(edits.map(e => e.metamodel))) {
        const otherDoc = this.store.docs.get(other);
        if (other !== metamodel && otherDoc) changes.set(other, features.applyTextEdits(otherDoc, edits.filter(e => e.metamodel === other)));
      }
      if (changes.size) {
        await this.store.setTexts(changes);
        this.events.emit({ type: 'instances' });
      }
      return { edits, applied: [...changes.keys()] };
    });
  }

  quickFixes(metamodel: string, text: string, line: number, column: number): Promise<QuickFix[]> {
    return this.queue.run(async () => {
      if (!this.store.languages.has(metamodel)) return [];
      await this.store.docFor(metamodel, text);
      return quickFixes(this.store, metamodel, line, column);
    });
  }

  applyQuickFix(fix: QuickFix): Promise<InstanceState> {
    return this.queue.run(() => applyQuickFix(
      this.store,
      fix,
      (metamodel, op) => this.applyEditNow(metamodel, op),
      metamodel => this.createInstanceNow(metamodel)
    ));
  }

  undo(metamodel: string): Promise<InstanceState> {
    return this.queue.run(() => this.step(metamodel, (current) => this.store.history.undo(metamodel, current)));
  }

  redo(metamodel: string): Promise<InstanceState> {
    return this.queue.run(() => this.step(metamodel, (current) => this.store.history.redo(metamodel, current)));
  }

  // ------------------------------------------------------------------ build

  /** The final model of the project, or the reasons it cannot be built. */
  build(project: string): Promise<BuildResult> {
    return this.queue.run(() => {
      const { composition } = this.store;
      if (!composition) return { ok: false, errors: ['No composition loaded'], warnings: [] };
      const states = this.store.states();
      const specs = new Map<string, JsonValue>();
      const errors: string[] = [];
      for (const s of states) {
        if (!s.available || !s.ast) continue;
        try { specs.set(s.metamodel, specOf(this.store, s.metamodel, {})!); } catch (e) { errors.push(`${s.metamodel}: ${(e as Error).message}`); }
      }
      let merged: JsonValue = {};
      try { merged = projectJson(this.store, {}); } catch (e) { errors.push((e as Error).message); }
      return buildModel(project, composition, states, { specs, merged, errors });
    });
  }

  // ----------------------------------------------------------------- events

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
  }

  dispose() {
    this.events.clear();
  }

  // -------------------------------------------------------------- internals

  private async setTextNow(metamodel: string, text: string, typing = false): Promise<InstanceState> {
    await this.store.setText(metamodel, text, typing);
    this.events.emit({ type: 'instance', metamodel });
    return this.store.state(metamodel);
  }

  /** Start an instance with the text of its minimal valid root (the existing one, if there is one). */
  private async createInstanceNow(metamodel: string): Promise<InstanceState> {
    if (this.store.texts.has(metamodel)) return this.store.state(metamodel);
    const { metamodel: m } = this.store.language(metamodel);
    const schema = buildFormSchema(m.grammar, m.reflection);
    const root = defaultDto(schema.root, schema, t => this.store.candidates(t));
    return this.setTextNow(metamodel, new Printer(indexRules(m.grammar)).print(root, 0) + '\n');
  }

  private async applyEditNow(metamodel: string, op: EditOp): Promise<InstanceState> {
    const text = this.store.texts.get(metamodel) ?? '';
    const { doc, lang } = await this.store.docFor(metamodel, text);
    const edited = applyEditToText(
      { text, doc, grammar: lang.metamodel.grammar, reflection: lang.metamodel.reflection, refCandidates: t => this.store.candidates(t) },
      op
    );
    return this.setTextNow(metamodel, edited);
  }

  /** Move through history: `pick` gives the text to go to, given the current one (undefined: nowhere to go). */
  private async step(metamodel: string, pick: (current: string) => string | undefined): Promise<InstanceState> {
    const current = this.store.texts.get(metamodel);
    const text = current === undefined ? undefined : pick(current);
    if (text === undefined) return this.store.state(metamodel);
    await this.store.restore(metamodel, text);
    this.events.emit({ type: 'instance', metamodel });
    return this.store.state(metamodel);
  }

  /** Runs an editor feature on the document of `text`; `fallback` when the metamodel is not available. */
  private withLiveDoc<T>(metamodel: string, text: string, fallback: T, fn: (lang: Language, doc: LangiumDocument) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      if (!this.store.languages.has(metamodel)) return fallback;
      const { lang, doc } = await this.store.docFor(metamodel, text);
      return fn(lang, doc);
    });
  }
}
