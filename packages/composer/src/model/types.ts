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
}

/**
 * The JSON mapping of a metamodel: turns the root of an instance into the plain JSON it contributes to the
 * project's specification. Written in `<metamodel>.spec.js`.
 */
export type SpecFn = (root: any) => unknown;

export type ConstraintFn = (node: unknown, accept: unknown, cancel?: unknown) => void;
/** What a `<metamodel>.constraints.js` returns: Langium validation checks keyed by AST type name. */
export type ConstraintSet = Record<string, ConstraintFn>;

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
  constraints: ConstraintSet[];
  /** the metamodel's own JSON mapping, when it has one */
  spec?: SpecFn;
  /** the mapping lays out the whole document and the others fill it in, so it is merged first */
  specRoot?: boolean;
}
