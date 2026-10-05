import type { ConstraintModule, ConstraintSet, ImportFn, ScriptHelpers, SpecFn, ValidationCategory } from '../model/types.js';

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

export const DEFAULT_HELPERS: ScriptHelpers = {
  refName, duplicates, n: (type, fields) => ({ $node: type, fields }), typeName: node => (node as { $type?: string } | undefined)?.$type
};

/** User code on purpose: the author's own validation rules and JSON mappings are function bodies that see the helpers as variables. */
const run = (code: string, helpers: ScriptHelpers): any =>
  new Function('typeName', 'refName', 'duplicates', 'n', `"use strict";\n${code}`)(helpers.typeName, helpers.refName, helpers.duplicates, helpers.n);

const CATEGORIES: ValidationCategory[] = ['fast', 'slow', 'built-in'];

/** One validator out of what a constraints file returned: bare checks, or a validator (object, class or class instance) with a `checks` map. */
function toModule(value: unknown, label: string): ConstraintModule {
  let candidate = value;
  // a validator class: Langium validators are classes, so a file may return the class itself
  if (typeof candidate === 'function') {
    try { candidate = new (candidate as new () => unknown)(); } catch { candidate = undefined; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`${label} must \`return { TypeName(node, accept) { ... } }\``);
  }
  const object = candidate as { checks?: unknown; category?: unknown };
  const holder = typeof object.checks === 'object' && object.checks !== null && !Array.isArray(object.checks);
  const checks = (holder ? object.checks : object) as Record<string, unknown>;
  for (const [k, v] of Object.entries(checks)) {
    if (typeof v !== 'function') throw new Error(`constraint '${k}' is not a function`);
  }
  if (holder && object.category !== undefined && !CATEGORIES.includes(object.category as ValidationCategory)) {
    throw new Error(`${label}: category must be one of ${CATEGORIES.map(c => `'${c}'`).join(', ')}, not ${JSON.stringify(object.category)}`);
  }
  return { checks: checks as ConstraintSet, ...(holder ? { thisObj: object, category: object.category as ValidationCategory | undefined } : {}) };
}

/**
 * `<metamodel>.constraints.js` holds a function body that returns Langium validation checks, `{ RuleName(node, accept) { ... } }`, or a
 * validator the way Langium writes them: `{ checks: { RuleName(node, accept) { ... } }, category: 'slow' }`, where `this` in a check is
 * the validator. An array holds several. Throws with a readable message when the code is invalid.
 */
export function compileConstraints(code: string, helpers: ScriptHelpers = DEFAULT_HELPERS): ConstraintModule[] {
  const result = run(code, helpers);
  const items: unknown[] = Array.isArray(result) ? result : [result];
  return items.map((item, i) => toModule(item, items.length > 1 ? `constraints[${i}]` : 'constraints'));
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

/**
 * `<metamodel>.import.js` holds a function body that returns `function (json, { n }) { return n('Model', { ... }) }`: the inverse of
 * the JSON mapping. `json` is the whole project document. Throws with a readable message when the code is invalid.
 * The returned function takes the document only: the helpers are already bound.
 */
export function compileImport(code: string, helpers: ScriptHelpers = DEFAULT_HELPERS): ImportFn {
  const result = run(code, helpers);
  if (typeof result !== 'function') throw new Error('an import mapping must `return function (json, { n }) { return n(\'Type\', { ... }) }`');
  return json => result(json, helpers);
}
