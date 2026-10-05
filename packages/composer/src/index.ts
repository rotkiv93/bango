export { ModelComposer } from './compose/composer.js';
export { Composition } from './compose/composition.js';
export { CompositeAstReflection } from './grammar/reflection.js';
export { compileConstraints, compileSpec, type ScriptHelpers } from './scripts/compile.js';
export { planRenames, rewriteTexts, declarationsOf } from './compose/collisions.js';
export { toAstDto, metamodelOfDocument, metamodelOfPath } from './model/ast-dto.js';
export { toProblem, wholeFile } from './model/problems.js';
export { flatten, bundleText, hasEntryRule } from './grammar/flatten.js';
export type { ComposedMetamodel, ConstraintFn, ConstraintSet, SpecFn, SpecHelpers } from './model/types.js';
// the plain data types live in @bango/core; re-exported so composer users need only this package
export type {
  AstDto, CompositionInfo, CompositionProblem, GrammarInfo, LanguageInfo, Problem, Range0, RefDto, SelectionCheck, TypeRename
} from '@bango/core';
