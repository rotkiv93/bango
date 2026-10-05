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
 * `<metamodel>.spec.js` holds a function body that returns `function (model, { refName }) { return { ... } }`, or
 * `{ root: true, map(model, { refName }) { ... } }` for the mapping that lays out the whole document (it is
 * merged first, so its key order becomes the document's order). Throws with a readable message when the code is invalid.
 */
export function compileSpec(code: string): { map: SpecFn; root: boolean } {
  const result = new Function(`"use strict";\n${code}`)();
  if (typeof result === 'function') return { map: result as SpecFn, root: false };
  if (result && typeof result === 'object' && typeof result.map === 'function') return { map: result.map.bind(result) as SpecFn, root: !!result.root };
  throw new Error('a JSON mapping must `return function (model, { refName }) { ... }` or `return { root: true, map(model, { refName }) { ... } }`');
}
