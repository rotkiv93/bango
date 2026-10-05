import { ModelComposer, type Composition, type CompositionInfo, type GrammarInfo, type SelectionCheck } from '@bango/composer';
import { ModelEngine } from '../core/engine.js';
import { runCases } from '../core/cases.js';
import { SerialQueue } from '../core/serial-queue.js';
import type {
  BangoApi,
  BuildResult,
  CaseResult,
  CompletionDto,
  DefinitionDto,
  EditOp,
  EngineEvent,
  AstDto,
  FormSchema,
  InstanceState,
  JsonSpecOptions,
  JsonValue,
  LocationDto,
  MetamodelCase,
  QuickFix,
  RenameResult,
  SymbolDto,
  RefCandidate,
  Unsubscribe
} from '@bango/core';

/**
 * Composer + engine behind one async interface: set grammars, compose a selection, edit instances.
 * Use it directly in a page, or serve it from a worker (`@bango/engine/worker`) and talk to it with the same API.
 */
export class Bango implements BangoApi {
  readonly composer = new ModelComposer();
  readonly engine = new ModelEngine();
  private composition?: Composition;

  /** Composer operations run one at a time and in call order, so overlapping `compose` calls cannot apply out of order. */
  private queue = new SerialQueue();
  private run<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.queue.run(fn);
  }

  setGrammar(name: string, text: string): Promise<void> {
    return this.run(() => { this.composer.setGrammar(name, text); });
  }

  removeGrammar(name: string): Promise<void> {
    return this.run(() => { this.composer.removeGrammar(name); });
  }

  setSpec(metamodel: string, code: string): Promise<void> {
    return this.run(() => { this.composer.setSpec(metamodel, code); });
  }

  setConstraints(metamodel: string, code: string): Promise<void> {
    return this.run(() => { this.composer.setConstraints(metamodel, code); });
  }

  compose(selection?: string[]): Promise<CompositionInfo> {
    return this.run(async () => {
      const composition = await this.composer.compose(selection);
      await this.engine.use(composition);
      this.composition = composition;
      return composition.info();
    });
  }

  bundleText(metamodel: string): Promise<string> {
    return this.run(() => {
      if (!this.composition) throw new Error('Call compose() first');
      return this.composition.bundleText(metamodel);
    });
  }

  listMetamodels(): Promise<GrammarInfo[]> {
    return this.run(() => this.composer.metamodels());
  }

  checkSelection(selection: string[]): Promise<SelectionCheck> {
    return this.run(() => this.composer.check(selection));
  }

  getTypings(grammar: string): Promise<string> {
    return this.run(() => this.composer.typings(grammar));
  }

  runCases(metamodel: string, cases: MetamodelCase[]): Promise<CaseResult[]> {
    return this.run(() => runCases(this.composer, metamodel, cases));
  }

  getGrammarAst(name: string): Promise<AstDto | undefined> {
    return this.run(() => this.composition?.grammarAst(name));
  }

  getInstance(metamodel: string): Promise<InstanceState> { return this.engine.getInstance(metamodel); }
  getInstances(): Promise<InstanceState[]> { return this.engine.getInstances(); }
  getComposition(): Promise<CompositionInfo | undefined> { return this.engine.getComposition(); }
  setText(metamodel: string, text: string): Promise<InstanceState> { return this.engine.setText(metamodel, text); }
  setInstances(texts: Record<string, string>): Promise<InstanceState[]> { return this.engine.setInstances(texts); }
  createInstance(metamodel: string): Promise<InstanceState> { return this.engine.createInstance(metamodel); }
  removeInstance(metamodel: string): Promise<void> { return this.engine.removeInstance(metamodel); }
  applyEdit(metamodel: string, op: EditOp): Promise<InstanceState> { return this.engine.applyEdit(metamodel, op); }
  getFormSchema(metamodel: string): Promise<FormSchema | undefined> { return this.engine.getFormSchema(metamodel); }
  toJson(metamodel: string, options?: JsonSpecOptions): Promise<JsonValue | undefined> { return this.engine.toJson(metamodel, options); }
  toProjectJson(options?: JsonSpecOptions): Promise<JsonValue> { return this.engine.toProjectJson(options); }
  getRefCandidates(refType: string): Promise<RefCandidate[]> { return this.engine.getRefCandidates(refType); }
  complete(metamodel: string, text: string, line: number, column: number): Promise<CompletionDto[]> { return this.engine.complete(metamodel, text, line, column); }
  hover(metamodel: string, text: string, line: number, column: number): Promise<string | undefined> { return this.engine.hover(metamodel, text, line, column); }
  definition(metamodel: string, text: string, line: number, column: number): Promise<DefinitionDto[]> { return this.engine.definition(metamodel, text, line, column); }
  references(metamodel: string, text: string, line: number, column: number): Promise<LocationDto[]> { return this.engine.references(metamodel, text, line, column); }
  symbols(metamodel: string, text: string): Promise<SymbolDto[]> { return this.engine.symbols(metamodel, text); }
  rename(metamodel: string, text: string, line: number, column: number, newName: string): Promise<RenameResult> { return this.engine.rename(metamodel, text, line, column, newName); }
  quickFixes(metamodel: string, text: string, line: number, column: number): Promise<QuickFix[]> { return this.engine.quickFixes(metamodel, text, line, column); }
  applyQuickFix(fix: QuickFix): Promise<InstanceState> { return this.engine.applyQuickFix(fix); }
  undo(metamodel: string): Promise<InstanceState> { return this.engine.undo(metamodel); }
  redo(metamodel: string): Promise<InstanceState> { return this.engine.redo(metamodel); }
  build(project: string): Promise<BuildResult> { return this.engine.build(project); }
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe | Promise<Unsubscribe> { return this.engine.subscribe(listener); }
}
