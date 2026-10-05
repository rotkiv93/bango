import type { ConstraintSet, ScriptHelpers, SpecFn } from '../model/types.js';

/** The name a reference points at: the target's name, or the text as written when it does not resolve. */
const refName = (ref: unknown): string | undefined => {
  const r = ref as { ref?: { name?: unknown }; $refText?: string } | undefined;
  return typeof r?.ref?.name === 'string' ? r.ref.name : r?.$refText;
};

/** The items that repeat the key of an earlier one (the later ones), with their index in `items`. */
const duplicates: ScriptHelpers['duplicates'] = (items, key = item => item) => {
  const seen = new Set<unknown>();
  const out: { item: (typeof items)[number]; index: number }[] = [];
  items.forEach((item, index) => {
    const k = key(item);
    if (seen.has(k)) out.push({ item, index });
    else seen.add(k);
  });
  return out;
};

export const DEFAULT_HELPERS: ScriptHelpers = { refName, duplicates, typeName: node => (node as { $type?: string } | undefined)?.$type };

/** User code on purpose: the author's own validation rules and JSON mappings are function bodies that see the helpers as variables. */
const run = (code: string, helpers: ScriptHelpers): any => new Function('typeName', 'refName', 'duplicates', `"use strict";\n${code}`)(helpers.typeName, helpers.refName, helpers.duplicates);

/**
 * `<metamodel>.constraints.js` holds a function body that returns `{ RuleName(node, accept) { ... } }`.
 * Throws with a readable message when the code is invalid.
 */
export function compileConstraints(code: string, helpers: ScriptHelpers = DEFAULT_HELPERS): ConstraintSet {
  const result = run(code, helpers);
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
 * The returned function takes the root node only: the helpers are already bound.
 */
export function compileSpec(code: string, helpers: ScriptHelpers = DEFAULT_HELPERS): { map: SpecFn; root: boolean } {
  const result = run(code, helpers);
  if (typeof result === 'function') return { map: root => result(root, helpers), root: false };
  if (result && typeof result === 'object' && typeof result.map === 'function') return { map: root => result.map(root, helpers), root: !!result.root };
  throw new Error('a JSON mapping must `return function (model, { refName }) { ... }` or `return { root: true, map(model, { refName }) { ... } }`');
}
