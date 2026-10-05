// Plain data shared by every Bango package: serializable, no Langium objects, so it can cross a worker boundary.

export interface Range0 {
  /** all positions are 0-based */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface RefDto {
  text: string;
  resolved: boolean;
  targetType?: string;
  targetName?: string;
  /** metamodel (document) that holds the target; can differ from the referencing one */
  targetMetamodel?: string;
}

export interface AstDto {
  type: string;
  name?: string;
  range?: Range0;
  /** primitive values (strings, numbers, booleans) and lists of them */
  props: Record<string, string | number | boolean | null | (string | number | boolean | null)[]>;
  refs: Record<string, RefDto | RefDto[]>;
  children: Record<string, AstDto | AstDto[]>;
}

export interface Problem {
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  /** 0-based */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** A metamodel (or library grammar) as the outside world sees it: serializable, no Langium objects. */
export interface GrammarInfo {
  /** grammar file name without extension, e.g. `datamodel` */
  name: string;
  /** file extension of its instances; undefined for libraries (grammars without an entry rule) */
  extension?: string;
  imports: string[];
  /** the first `//` comment of the grammar, shown to users choosing metamodels */
  description?: string;
  /** metamodels (grammars with an entry rule) imported directly or transitively: a project using this one must include them */
  requires: string[];
  problems: Problem[];
}

export interface LanguageInfo {
  /** metamodel name */
  name: string;
  extension: string;
  /** every keyword literal of the grammar and its imports, used for highlighting */
  keywords: string[];
  /** the metamodel has an import mapping, so `importJson` can fill its instance from a project's JSON */
  canImport: boolean;
  /** true when the grammar currently has errors and this is the last version that compiled */
  stale: boolean;
}

export interface CompositionProblem {
  /** metamodel with the unmet requirement */
  metamodel: string;
  /** metamodel that is missing from the selection */
  missing: string;
  message: string;
}

/** A type name that clashed between metamodels of a project, and what it was renamed to there. */
export interface TypeRename {
  /** the grammar whose type was renamed */
  file: string;
  original: string;
  renamed: string;
  /** the grammar that keeps the name */
  keeper: string;
}

export interface CompositionInfo {
  /** metamodels the project asked for */
  selection: string[];
  grammars: GrammarInfo[];
  /** metamodels of the selection that can be used right now */
  languages: LanguageInfo[];
  problems: CompositionProblem[];
  /** type names that clash between the metamodels of the selection, and what they are called in it */
  renames: TypeRename[];
}

/** Can this selection of metamodels be used as a project? Answered without loading anything. */
export interface SelectionCheck {
  ok: boolean;
  /** everything that is wrong, in plain language */
  errors: string[];
  /** the unmet requirements among the errors, for quick-fixes */
  problems: CompositionProblem[];
  /** the selection plus every metamodel it requires: what to select to make it valid */
  suggested: string[];
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSpecOptions {
  /**
   * `spec` (default): the metamodel's own JSON mapping (`<metamodel>.spec.js`), falling back to `generic` when it has none.
   * `generic`: the instance as a plain tree, same shape for every metamodel.
   */
  format?: 'spec' | 'generic';
  /** project JSON only: merge the specs of all metamodels into one document (default), or keep one per metamodel */
  merge?: boolean;
  /** generic format: `detailed` (default): `{ $ref, $type, $in }`; `names`: just the referenced name */
  refs?: 'detailed' | 'names';
  /** generic format: include `$type` on nodes (default true) */
  types?: boolean;
  /** generic format: include `$range` (line/column of the node in the text) on nodes (default false) */
  ranges?: boolean;
}

// ------------------------------------------------------------------- instances

export interface InstanceState {
  /** metamodel this instance belongs to; a project has at most one instance per metamodel */
  metamodel: string;
  text: string;
  /** undefined when the metamodel is not available (see `problems` for why) */
  ast?: AstDto;
  problems: Problem[];
  /** the metamodel currently has errors and the last version that compiled is being used */
  stale: boolean;
  available: boolean;
  /** there is an earlier text to go back to (`undo`) */
  canUndo?: boolean;
  /** there is a later text to go forward to (`redo`) */
  canRedo?: boolean;
}

export interface InstanceAst {
  metamodel: string;
  ast: AstDto;
}

// ----------------------------------------------------------------------- forms

export interface FieldSchema {
  name: string;
  kind: 'text' | 'number' | 'boolean' | 'ref' | 'child' | 'enum';
  /** list feature (`+=`) */
  many: boolean;
  required: boolean;
  /** text fields: true when the grammar uses a quoted STRING terminal */
  quoted?: boolean;
  /** ref fields: AST type of the possible targets (may live in another metamodel) */
  refType?: string;
  /** child fields: concrete node types that can be created here */
  childTypes?: string[];
  /** enum fields: the keyword choices */
  options?: string[];
}

export interface TypeSchema {
  type: string;
  fields: FieldSchema[];
}

export interface FormSchema {
  /** type produced by the entry rule */
  root: string;
  types: Record<string, TypeSchema>;
}

/** One step down the AST: feature name plus index when the feature is a list. */
export interface PathStep {
  feature: string;
  index?: number;
}

export type EditOp =
  /** change a scalar/ref/enum/boolean value (or one item of a list when `index` is given) */
  | { kind: 'set'; path: PathStep[]; feature: string; index?: number; value: string | number | boolean | null }
  /** add a child node (`type`) or a list item (`value`) to a feature */
  | { kind: 'add'; path: PathStep[]; feature: string; type?: string; value?: string }
  /** remove a node (path points at it), or one item of a list feature when `feature`+`index` are given */
  | { kind: 'remove'; path: PathStep[]; feature?: string; index?: number };

export interface RefCandidate {
  name: string;
  type: string;
  /** metamodel of the instance that declares it */
  metamodel: string;
}

// --------------------------------------------------------------- editor support

export interface CompletionDto {
  label: string;
  detail?: string;
  /** LSP CompletionItemKind */
  kind?: number;
  insertText: string;
  /** replaces this range when present */
  range?: Range0;
}

export interface DefinitionDto {
  /** metamodel of the instance that contains the target */
  metamodel: string;
  target: Range0;
}

/** A place in the text of one instance. */
export interface LocationDto {
  metamodel: string;
  range: Range0;
}

export interface TextEditDto extends LocationDto {
  newText: string;
}

export interface RenameResult {
  /** why the symbol cannot be renamed (nothing was changed) */
  error?: string;
  /** every change, in every instance, positions as in the texts before the rename */
  edits: TextEditDto[];
  /**
   * The metamodels whose text the engine has already changed. The one that asked is not among them: its editor holds the live
   * text, so it applies its own `edits` (and the engine learns the result as it would from any edit).
   */
  applied: string[];
}

/** An entry of the outline of an instance. */
export interface SymbolDto {
  name: string;
  detail?: string;
  /** LSP SymbolKind */
  kind: number;
  range: Range0;
  selectionRange: Range0;
  children: SymbolDto[];
}

/** A way to fix a problem that may lie in another instance: create what a reference points at. Plain data, so it can travel to a worker and back. */
export interface QuickFix {
  title: string;
  /** the instance that gets the new node (created if the project has none yet) */
  metamodel: string;
  /** the node type to create there */
  type: string;
  /** its name */
  name: string;
}

// ----------------------------------------------------------------------- build

export interface BuiltInstance {
  metamodel: string;
  extension: string;
  ast: AstDto;
  /** the instance's JSON: its metamodel's mapping, or the generic tree when it has none */
  spec: JsonValue;
}

export interface BuildResult {
  ok: boolean;
  /** why the project cannot be built (empty when ok) */
  errors: string[];
  warnings: string[];
  /** the final model: every instance as a resolved AST, only present when ok */
  model?: {
    project: string;
    metamodels: { name: string; extension: string; requires: string[] }[];
    instances: BuiltInstance[];
    /** the specs of every metamodel that has a JSON mapping, merged into the one project document */
    spec: JsonValue;
  };
}

// ------------------------------------------------------------- metamodel tests

/** A sample instance of a metamodel and what checking it must report: the way to test a grammar and its constraints. */
export interface MetamodelCase {
  name: string;
  /** the instance text */
  text: string;
  /** instances of the metamodels this one needs (by metamodel), when the sample refers to them */
  with?: Record<string, string>;
  expect: {
    /**
     * The errors the sample must have, each a piece of the message, no more and no fewer. Omitted: no errors at all.
     */
    errors?: string[];
    /** Same for warnings. Omitted: warnings are not checked. */
    warnings?: string[];
  };
}

export interface CaseResult {
  name: string;
  ok: boolean;
  /** what differed from the expectation, in plain language (empty when ok) */
  failures: string[];
  /** what the sample actually reported */
  problems: Problem[];
}

// ------------------------------------------------------------------- json import

/** What `importJson` made of a project's JSON. */
export interface ImportResult {
  /** the instance text of every metamodel that has an import mapping and produced one */
  texts: Record<string, string>;
  /** metamodels of the project with no import mapping: their instances are not part of the result */
  skipped: string[];
  /** metamodels whose import mapping failed, and why */
  errors: string[];
  /** what the new instances report, each checked next to the others (as it will be once they are set) */
  problems: Record<string, Problem[]>;
}

// ---------------------------------------------------------------------- events

/**
 * `composition`: the set of languages changed. `instances`: the whole set of instances was replaced. `instance`: one was edited; because every instance is
 * relinked on each change, any instance may have new problems, so listeners should re-read what they show.
 */
export type EngineEvent = { type: 'composition' } | { type: 'instances' } | { type: 'instance'; metamodel: string };
export type Unsubscribe = () => void;

/**
 * Everything a renderer needs. Implemented by the in-process `ModelEngine` and by the worker client,
 * so every method is async and every argument and result is plain data.
 */
export interface EngineApi {
  getInstance(metamodel: string): Promise<InstanceState>;
  getInstances(): Promise<InstanceState[]>;
  getComposition(): Promise<CompositionInfo | undefined>;
  setText(metamodel: string, text: string): Promise<InstanceState>;
  /** replace every instance at once (opening a project): one rebuild instead of one per instance */
  setInstances(texts: Record<string, string>): Promise<InstanceState[]>;
  /** start an instance of a metamodel with the text of its minimal valid root; returns the existing one if there is one */
  createInstance(metamodel: string): Promise<InstanceState>;
  removeInstance(metamodel: string): Promise<void>;
  applyEdit(metamodel: string, op: EditOp): Promise<InstanceState>;
  getFormSchema(metamodel: string): Promise<FormSchema | undefined>;
  /** the instance as plain JSON (the "spec"), or undefined when the metamodel is not available */
  toJson(metamodel: string, options?: JsonSpecOptions): Promise<JsonValue | undefined>;
  /** the project's JSON: every instance's spec merged into one document, or one entry per metamodel */
  toProjectJson(options?: JsonSpecOptions): Promise<JsonValue>;
  getRefCandidates(refType: string): Promise<RefCandidate[]>;
  /**
   * Turn a project's JSON back into instances: each metamodel with an import mapping builds its own instance from the whole document.
   * Changes nothing: apply `texts` with `setInstances` to use them.
   */
  importJson(json: JsonValue): Promise<ImportResult>;
  complete(metamodel: string, text: string, line: number, column: number): Promise<CompletionDto[]>;
  hover(metamodel: string, text: string, line: number, column: number): Promise<string | undefined>;
  definition(metamodel: string, text: string, line: number, column: number): Promise<DefinitionDto[]>;
  /** every place that refers to the symbol at the position, in every instance, and its declaration */
  references(metamodel: string, text: string, line: number, column: number): Promise<LocationDto[]>;
  /** the outline of an instance: its named elements, nested */
  symbols(metamodel: string, text: string): Promise<SymbolDto[]>;
  /** rename the symbol at the position everywhere it appears: its declaration and every reference, across the instances of the project */
  rename(metamodel: string, text: string, line: number, column: number, newName: string): Promise<RenameResult>;
  /** fixes for the problem at the position, e.g. creating the entity a reference names (in the instance that declares such things) */
  quickFixes(metamodel: string, text: string, line: number, column: number): Promise<QuickFix[]>;
  applyQuickFix(fix: QuickFix): Promise<InstanceState>;
  /** go back to the text before the last change (typing in quick succession counts as one change) */
  undo(metamodel: string): Promise<InstanceState>;
  redo(metamodel: string): Promise<InstanceState>;
  build(project: string): Promise<BuildResult>;
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe | Promise<Unsubscribe>;
}

/** The engine plus the composer, for code that wants one object (and for the worker boundary). */
export interface BangoApi extends EngineApi {
  setGrammar(name: string, text: string): Promise<void>;
  removeGrammar(name: string): Promise<void>;
  setConstraints(metamodel: string, code: string): Promise<void>;
  /** the JSON mapping of a metamodel (`<metamodel>.spec.js`) */
  setSpec(metamodel: string, code: string): Promise<void>;
  /** the import mapping of a metamodel (`<metamodel>.import.js`): the inverse of its JSON mapping */
  setImport(metamodel: string, code: string): Promise<void>;
  /** compose the selected metamodels and load the result into the engine, keeping instance texts */
  compose(selection?: string[]): Promise<CompositionInfo>;
  /** self-contained `.langium` text of one composed metamodel */
  bundleText(metamodel: string): Promise<string>;
  /** the AST of a grammar itself, for any grammar of the workspace */
  getGrammarAst(name: string): Promise<AstDto | undefined>;
  /** every grammar of the workspace with its description, requirements and problems */
  listMetamodels(): Promise<GrammarInfo[]>;
  /** can this selection of metamodels be a project? Does not touch the loaded instances. */
  checkSelection(selection: string[]): Promise<SelectionCheck>;
  /** TypeScript declarations for the scripts (constraints, JSON mapping) of a grammar, from its AST types: load them in an editor for completion */
  getTypings(grammar: string): Promise<string>;
  /**
   * Check sample instances of a metamodel: composes it with what it requires, loads each sample and compares what is reported
   * with what the case expects. Does not touch the loaded composition or instances.
   */
  runCases(metamodel: string, cases: MetamodelCase[]): Promise<CaseResult[]>;
}
