import type { AstDto, CompositionInfo, GrammarInfo, Problem, Range0, RefDto, SelectionCheck } from '@bango/composer';

export type { AstDto, CompositionInfo, GrammarInfo, Problem, Range0, RefDto, SelectionCheck };

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
