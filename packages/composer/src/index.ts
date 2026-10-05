export { ModelComposer } from './compose/composer.js';
export { Composition } from './compose/composition.js';
export { CompositeAstReflection } from './grammar/reflection.js';
export { compileConstraints, compileSpec } from './scripts/compile.js';
export { toAstDto } from './model/ast-dto.js';
export { documentUri, nameOfDocument, nameOfPath, nameOfUri } from './model/documents.js';
export { toProblem, wholeFile } from './model/problems.js';
export type { ComposedMetamodel, ConstraintFn, ConstraintSet, ScriptHelpers, SpecFn } from './model/types.js';
// the plain data types live in @bango/core; re-exported so composer users need only this package
export type {
  AstDto, CompositionInfo, CompositionProblem, GrammarInfo, LanguageInfo, Problem, Range0, RefDto, SelectionCheck, TypeRename
} from '@bango/core';
