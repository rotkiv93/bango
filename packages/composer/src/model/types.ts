import type { AstReflection, Grammar } from 'langium';

/**
 * What user code (constraints, JSON mappings) can call without importing anything: free variables of the script, and
 * the second argument of a JSON mapping.
 */
export interface ScriptHelpers {
  /** the name a reference points at (the target's name, or the written text when it does not resolve) */
  refName(ref: unknown): string | undefined;
  /**
   * The name of a node's type as the metamodel's author wrote it: the same as `node.$type` unless the composer had to
   * rename the type because another metamodel of the project declares one with the same name.
   */
  typeName(node: unknown): string | undefined;
  /** the items that repeat the key of an earlier one, with their index: `duplicates(entity.fields, f => f.name)` */
  duplicates<T>(items: T[], key?: (item: T) => unknown): { item: T; index: number }[];
  /**
   * Import mappings only: describe a node of the instance, `n('Entity', { name: 'Road', fields: [...] })`. Values go by what the
   * grammar says each feature is: text and numbers as they are, a reference as the name it points at, a child as another `n(...)`.
   */
  n(type: string, fields: Record<string, unknown>): ImportNode;
}

/** A node of the instance an import mapping describes: its type, and a value for each feature that is set. */
export interface ImportNode {
  $node: string;
  fields: Record<string, unknown>;
}

/**
 * The inverse of a JSON mapping: turns the project's JSON back into the tree of this metamodel's instance. Written in
 * `<metamodel>.import.js`. The engine prints the tree as text.
 */
export type ImportFn = (json: any) => ImportNode;

/**
 * The JSON mapping of a metamodel: turns the root of an instance into the plain JSON it contributes to the
 * project's specification. Written in `<metamodel>.spec.js`.
 */
export type SpecFn = (root: any) => unknown;

export type ConstraintFn = (node: unknown, accept: unknown, cancel?: unknown) => void;
/** Langium validation checks keyed by AST type name: what `ValidationRegistry.register` takes. */
export type ConstraintSet = Record<string, ConstraintFn>;

/** When Langium runs a check: `fast` on every edit, `slow` only when asked, `built-in` with the generated checks. */
export type ValidationCategory = 'fast' | 'slow' | 'built-in';

/**
 * One validator, the way Langium registers it: `ValidationRegistry.register(checks, thisObj, category)`. A `<metamodel>.constraints.js`
 * returns one of these, several in an array, a bare `checks` object, or a validator (class instance) that has a `checks` map.
 */
export interface ConstraintModule {
  checks: ConstraintSet;
  /** `this` inside the checks: the validator they belong to, so it can have helper methods */
  thisObj?: object;
  category?: ValidationCategory;
}

/** What a scope function is told besides the node whose reference is being resolved. */
export interface ScopeInfo {
  /** the name of the reference feature (`property` in `FormField`) */
  property: string;
  /** which item of a list feature, when it is one */
  index?: number;
}

/**
 * Which nodes a reference can point at, there: the function gets the node that holds the reference (`FormField`, for its `property`)
 * and returns the nodes that are visible from it. `undefined` means "no opinion": Langium's default scope (every exported node of the
 * right type, across the project) is used. Written in `<metamodel>.scope.js`.
 */
export type ScopeFn = (node: any, info: ScopeInfo) => unknown[] | undefined;

/** The scope functions of one `scope.js`: node type name -> reference feature -> function. */
export type ScopeSet = Record<string, Record<string, ScopeFn>>;

/** A metamodel compiled for use: its own grammar with every import inlined. */
export interface ComposedMetamodel {
  name: string;
  extension: string;
  /** the grammar with imported rules inlined and a single entry rule */
  grammar: Grammar;
  reflection: AstReflection;
  /** metamodel files (without extension) whose rules are included, itself first */
  sources: string[];
  requires: string[];
  /** the last version that compiled is being served because the current one has errors */
  stale: boolean;
  /** compiled constraint files of every source */
  constraints: ConstraintModule[];
  /** compiled scope scripts of every source: which nodes each reference feature can point at */
  scopes: ScopeSet[];
  /** the metamodel's own JSON mapping, when it has one */
  spec?: SpecFn;
  /** the inverse of the JSON mapping, when it has one */
  importer?: ImportFn;
  /** the mapping lays out the whole document and the others fill it in, so it is merged first */
  specRoot?: boolean;
}
