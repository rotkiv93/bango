import type { AstReflection, Grammar } from 'langium';

/** Helpers handed to a JSON mapping. */
export interface SpecHelpers {
  /** the name a reference points at (the target's name, or the written text when it does not resolve) */
  refName(ref: unknown): string | undefined;
}

/**
 * The JSON mapping of a metamodel: turns the root of an instance into the plain JSON it contributes to the
 * project's specification. Written in `<metamodel>.spec.js`.
 */
export type SpecFn = (root: any, helpers: SpecHelpers) => unknown;

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
