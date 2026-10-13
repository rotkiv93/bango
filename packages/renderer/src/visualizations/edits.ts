import type { AstDto, EngineApi, InstanceState, PathStep } from '@bango/core';
import { asArray } from '../dom/dom.js';
import { nodeAt } from '../views/form/form-renderer.js';
import type { Editor, EditorFailure } from './types.js';

export { nodeAt };

/** Every node of a tree, with its path in the instance (the same paths `applyEdit` takes). */
export function walk(ast: AstDto, visit: (node: AstDto, path: PathStep[]) => void): void {
  const go = (node: AstDto, path: PathStep[]) => {
    visit(node, path);
    for (const [feature, value] of Object.entries(node.children)) {
      asArray(value).forEach((child, i) => go(child, [...path, { feature, index: Array.isArray(value) ? i : undefined }]));
    }
  };
  go(ast, []);
}

/** The path of the node that `add` has just put at the end of `feature`. */
function lastChild(state: InstanceState, path: PathStep[], feature: string): PathStep[] | undefined {
  const parent = state.ast && nodeAt(state.ast, path);
  const child = parent?.children[feature];
  if (child === undefined) return undefined;
  return [...path, { feature, index: Array.isArray(child) ? child.length - 1 : undefined }];
}

/** Edits the instance of `metamodel` through the engine's tree edits. The engine refuses what the grammar does not allow: that is `onFailure`'s. */
export function editor(engine: EngineApi, metamodel: string, onFailure: EditorFailure = () => undefined): Editor {
  const attempt = async <T,>(fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      onFailure((e as Error).message);
      return fallback;
    }
  };
  const add = (path: PathStep[], feature: string, type?: string) =>
    attempt<PathStep[] | undefined>(undefined, async () => lastChild(await engine.applyEdit(metamodel, { kind: 'add', path, feature, type }), path, feature));
  return {
    add,
    addNamed: async (path, feature, type, name) => {
      const created = await add(path, feature, type);
      if (!created) return undefined;
      const named = await attempt(false, async () => { await engine.applyEdit(metamodel, { kind: 'set', path: created, feature: 'name', value: name }); return true; });
      return named ? created : undefined;
    },
    addValue: (path, feature, value) => attempt(false, async () => { await engine.applyEdit(metamodel, { kind: 'add', path, feature, value }); return true; }),
    set: (path, feature, value, index) => attempt(false, async () => { await engine.applyEdit(metamodel, { kind: 'set', path, feature, index, value }); return true; }),
    remove: (path, feature, index) => attempt(false, async () => { await engine.applyEdit(metamodel, { kind: 'remove', path, feature, index }); return true; })
  };
}

/** `text` cut to about `width` pixels at 11px, with an ellipsis. */
export function fitText(text: string, width: number): string {
  const chars = Math.max(1, Math.floor(width / 6.2));
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
}
