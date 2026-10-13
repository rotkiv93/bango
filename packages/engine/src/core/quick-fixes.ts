import { AstUtils, isReference } from 'langium';
import type { AstDto, EditOp, FieldSchema, FormSchema, InstanceState, PathStep, QuickFix } from '@bango/core';
import { buildFormSchema } from '../editing/schema.js';
import type { InstanceStore } from './instance-store.js';

/** The reference at the position that does not resolve, with the node type it should point at. */
function unresolvedReferenceAt(store: InstanceStore, metamodel: string, line: number, character: number): { text: string; type: string } | undefined {
  const doc = store.docs.get(metamodel);
  const lang = store.languages.get(metamodel);
  if (!doc || !lang) return undefined;
  const offset = doc.textDocument.offsetAt({ line, character });
  for (const { reference, container, property } of AstUtils.streamAst(doc.parseResult.value).flatMap(node => AstUtils.streamReferences(node))) {
    if (!isReference(reference)) continue;
    const node = reference.$refNode;
    if (!node || offset < node.offset || offset > node.end || reference.ref) continue;
    const type = lang.metamodel.reflection.getReferenceType({ container, property, reference });
    return { text: reference.$refText, type };
  }
  return undefined;
}

/** How deep below the root of an instance a node can be added. */
const DEPTH = 4;

/**
 * Whether a node of `type` can be added somewhere in an instance of this schema: some type reachable from the root has a child
 * feature that takes it. A metamodel that merely imports the rule (so that it can refer to it) has no such place.
 */
function canHold(schema: FormSchema, accepts: (t: string) => boolean): boolean {
  let level = [schema.root];
  const seen = new Set(level);
  for (let depth = 0; depth < DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const type of level) {
      for (const f of schema.types[type]?.fields ?? []) {
        if (f.kind !== 'child') continue;
        if (f.childTypes?.some(accepts)) return true;
        for (const t of f.childTypes ?? []) if (!seen.has(t)) { seen.add(t); next.push(t); }
      }
    }
    level = next;
  }
  return false;
}

/** Concrete node types that can be created for `type`, with the metamodel whose instances can hold them. */
function creatableAs(store: InstanceStore, type: string): { metamodel: string; type: string }[] {
  const found: { metamodel: string; type: string }[] = [];
  for (const [metamodel, lang] of store.languages) {
    const { grammar, reflection } = lang.metamodel;
    const schema = buildFormSchema(grammar, reflection);
    for (const t of Object.keys(schema.types)) {
      if (!reflection.isSubtype(t, type) || !schema.types[t].fields.some(f => f.name === 'name')) continue;
      if (canHold(schema, ct => reflection.isSubtype(t, ct))) found.push({ metamodel, type: t });
    }
  }
  return found;
}

/**
 * Fixes for the problem at a position. For a reference that does not resolve: create what it names, in the instance of the
 * metamodel that declares nodes of that type (which may be another one than the instance being edited).
 */
export function quickFixes(store: InstanceStore, metamodel: string, line: number, character: number): QuickFix[] {
  const missing = unresolvedReferenceAt(store, metamodel, line, character);
  if (!missing || !missing.text) return [];
  return creatableAs(store, missing.type).map(c => ({
    title: c.metamodel === metamodel ? `Create ${c.type} '${missing.text}'` : `Create ${c.type} '${missing.text}' in ${c.metamodel}`,
    metamodel: c.metamodel,
    type: c.type,
    name: missing.text
  }));
}

/** Where in an instance a node of `type` can be added: the shallowest list (or empty single feature) that accepts it. */
function placeFor(root: AstDto, schema: FormSchema, accepts: (t: string) => boolean): { path: PathStep[]; feature: string } | undefined {
  let level: { dto: AstDto; path: PathStep[] }[] = [{ dto: root, path: [] }];
  for (let depth = 0; depth < DEPTH && level.length; depth++) {
    const next: typeof level = [];
    for (const { dto, path } of level) {
      const fields: FieldSchema[] = schema.types[dto.type]?.fields.filter(f => f.kind === 'child') ?? [];
      for (const f of fields) {
        const present = dto.children[f.name];
        if (f.childTypes?.some(accepts) && (f.many || !present)) return { path, feature: f.name };
      }
      for (const f of fields) {
        const present = dto.children[f.name];
        const items = Array.isArray(present) ? present : present ? [present] : [];
        items.forEach((child, index) => next.push({ dto: child, path: [...path, { feature: f.name, ...(f.many ? { index } : {}) }] }));
      }
    }
    level = next;
  }
  return undefined;
}

/** Create the node a fix describes, in its instance (which is started if the project has none yet). */
export async function applyQuickFix(
  store: InstanceStore,
  fix: QuickFix,
  edit: (metamodel: string, op: EditOp) => Promise<InstanceState>,
  create: (metamodel: string) => Promise<InstanceState>
): Promise<InstanceState> {
  const { reflection, grammar } = store.language(fix.metamodel).metamodel;
  let state = store.texts.has(fix.metamodel) ? store.state(fix.metamodel) : await create(fix.metamodel);
  if (!state.ast) throw new Error(`'${fix.metamodel}' cannot be edited right now: ${state.problems[0]?.message ?? 'it has errors'}`);
  const schema = buildFormSchema(grammar, reflection);
  const place = placeFor(state.ast, schema, t => reflection.isSubtype(fix.type, t));
  if (!place) throw new Error(`There is no place in '${fix.metamodel}' to add a ${fix.type}`);

  state = await edit(fix.metamodel, { kind: 'add', path: place.path, feature: place.feature, type: fix.type });
  // the new node is the last of its list (or the only one): give it its name
  const parent = place.path.reduce<AstDto | undefined>((dto, step) => {
    const v = dto?.children[step.feature];
    return Array.isArray(v) ? v[step.index ?? 0] : v;
  }, state.ast);
  const added = parent?.children[place.feature];
  const index = Array.isArray(added) ? added.length - 1 : undefined;
  const nodePath: PathStep[] = [...place.path, { feature: place.feature, ...(index !== undefined ? { index } : {}) }];
  return edit(fix.metamodel, { kind: 'set', path: nodePath, feature: 'name', value: fix.name });
}
