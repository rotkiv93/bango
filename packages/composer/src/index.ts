export { ModelComposer } from './compose/composer.js';
export { Composition } from './compose/composition.js';
export { CompositeAstReflection } from './grammar/reflection.js';
export { compileConstraints, compileSpec } from './scripts/compile.js';
export { toAstDto, metamodelOfDocument, metamodelOfPath } from './model/ast-dto.js';
export { toProblem, wholeFile } from './model/problems.js';
export { flatten, bundleText, hasEntryRule } from './grammar/flatten.js';
export type {
  AstDto,
  RefDto,
  Range0,
  ComposedMetamodel,
  CompositionInfo,
  CompositionProblem,
  ConstraintFn,
  ConstraintSet,
  SpecFn,
  SpecHelpers,
  GrammarInfo,
  SelectionCheck,
  LanguageInfo,
  Problem
} from './model/types.js';
