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
  complete(metamodel: string, text: string, line: number, column: number): Promise<CompletionDto[]>;
  hover(metamodel: string, text: string, line: number, column: number): Promise<string | undefined>;
  definition(metamodel: string, text: string, line: number, column: number): Promise<DefinitionDto[]>;
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
}
