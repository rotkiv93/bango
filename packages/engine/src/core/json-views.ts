import { mergeJson, toJsonSpec, type JsonSpecOptions, type JsonValue } from '@bango/core';
import type { InstanceStore } from './instance-store.js';

/** An instance as JSON: its metamodel's own mapping when it has one (and `format` is not `generic`), else the generic tree. */
export function specOf(store: InstanceStore, metamodel: string, options: JsonSpecOptions): JsonValue | undefined {
  const doc = store.docs.get(metamodel);
  const lang = store.languages.get(metamodel);
  if (!doc || !lang) return undefined;
  const spec = options.format === 'generic' ? undefined : lang.metamodel.spec;
  if (!spec) {
    const ast = store.state(metamodel).ast;
    return ast ? toJsonSpec(ast, options) : undefined;
  }
  try {
    // through JSON, so what comes out is guaranteed to be plain data
    return JSON.parse(JSON.stringify(spec(doc.parseResult.value) ?? null)) as JsonValue;
  } catch (e) {
    throw new Error(`The JSON mapping of '${metamodel}' failed: ${(e as Error).message}`);
  }
}

/** The whole project as JSON: one entry per metamodel, or (default) the specs of the metamodels that have a JSON mapping, merged. */
export function projectJson(store: InstanceStore, options: JsonSpecOptions): JsonValue {
  const metamodels = [...store.texts.keys()].filter(m => store.docs.has(m));
  if (options.format === 'generic' || options.merge === false) {
    return Object.fromEntries(metamodels.map(m => [m, specOf(store, m, options)!]));
  }
  // metamodels without a JSON mapping have no place in the merged document
  const meta = (m: string) => store.languages.get(m)!.metamodel;
  const parts = metamodels
    .filter(m => meta(m).spec)
    // the root mapping first (it lays out the document, so its key order becomes the order of the merged document),
    // then the ones that need more before the ones that need less
    // (and by name when that is a tie, so the document does not depend on the order the metamodels were selected in)
    .sort((a, b) => Number(!!meta(b).specRoot) - Number(!!meta(a).specRoot) || meta(b).requires.length - meta(a).requires.length || a.localeCompare(b))
    .map(m => specOf(store, m, options)!);
  return mergeJson(...parts);
}
