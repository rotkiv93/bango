import type { ConstraintSet, SpecFn } from '../model/types.js';

/**
 * `<metamodel>.constraints.js` holds a function body that returns `{ RuleName(node, accept) { ... } }`.
 * Throws with a readable message when the code is invalid.
 */
export function compileConstraints(code: string): ConstraintSet {
  // user code on purpose: the playground evaluates the author's own validation rules
  const result = new Function(`"use strict";\n${code}`)();
  if (!result || typeof result !== 'object') throw new Error('constraints must `return { TypeName(node, accept) { ... } }`');
  for (const [k, v] of Object.entries(result)) {
    if (typeof v !== 'function') throw new Error(`constraint '${k}' is not a function`);
  }
  return result as ConstraintSet;
}

/**
 * `<metamodel>.spec.js` holds a function body that returns `function (model, { refName }) { return { ... } }`.
 * Throws with a readable message when the code is invalid.
 */
export function compileSpec(code: string): SpecFn {
  const result = new Function(`"use strict";\n${code}`)();
  if (typeof result !== 'function') throw new Error('a JSON mapping must `return function (model, { refName }) { ... }`');
  return result as SpecFn;
}
