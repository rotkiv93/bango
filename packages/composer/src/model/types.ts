import type { AstReflection, Grammar } from 'langium';

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

export interface CompositionInfo {
  /** metamodels the project asked for */
  selection: string[];
  grammars: GrammarInfo[];
  /** metamodels of the selection that can be used right now */
  languages: LanguageInfo[];
  problems: CompositionProblem[];
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
}
