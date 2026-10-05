import type { AstDto, PathStep, RefDto, TextEditDto } from '@bango/core';

/** The (0-based) line and column of the `n`th occurrence of `needle` in `text`, a character into it. */
export function at(text: string, needle: string, n = 0) {
  let from = -1;
  for (let i = 0; i <= n; i++) from = text.indexOf(needle, from + 1);
  if (from < 0) throw new Error(`no '${needle}' in the text`);
  const before = text.slice(0, from + 1).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}

/** What an editor does with the edits of its own instance: positions refer to `text`, so apply them back to front. */
export function applyOwnEdits(text: string, edits: Pick<TextEditDto, 'range' | 'newText'>[]) {
  const lines = text.split('\n');
  const offset = (line: number, column: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + column;
  let out = text;
  for (const e of [...edits].sort((a, b) => offset(b.range.startLine, b.range.startColumn) - offset(a.range.startLine, a.range.startColumn))) {
    out = out.slice(0, offset(e.range.startLine, e.range.startColumn)) + e.newText + out.slice(offset(e.range.endLine, e.range.endColumn));
  }
  return out;
}

/** Where a node is in an instance: the steps down from the root, as `applyEdit` takes them. */
export interface Site {
  path: PathStep[];
  node: AstDto;
}

/** Every node of an AST with the path to it, root first. */
export function sitesOf(root: AstDto): Site[] {
  const out: Site[] = [];
  const walk = (node: AstDto, path: PathStep[]) => {
    out.push({ path, node });
    for (const [feature, value] of Object.entries(node.children)) {
      if (Array.isArray(value)) value.forEach((child, index) => walk(child, [...path, { feature, index }]));
      else walk(value, [...path, { feature }]);
    }
  };
  walk(root, []);
  return out;
}

/** Every reference of an AST: the node it is in, its feature, and its index when the feature is a list. */
export function referencesOf(root: AstDto): { path: PathStep[]; feature: string; index?: number; ref: RefDto; type: string }[] {
  return sitesOf(root).flatMap(({ path, node }) =>
    Object.entries(node.refs).flatMap(([feature, value]) =>
      Array.isArray(value)
        ? value.map((ref, index) => ({ path, feature, index, ref, type: node.type }))
        : [{ path, feature, ref: value, type: node.type }]
    )
  );
}

/** The (0-based) position of the name of a node: its first whole-word occurrence after the node starts. */
export function nameOf(text: string, node: AstDto): { line: number; column: number } | undefined {
  if (!node.range || !node.name) return undefined;
  const lines = text.split('\n');
  const start = lines.slice(0, node.range.startLine).reduce((n, l) => n + l.length + 1, 0) + node.range.startColumn;
  const escaped = node.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).exec(text.slice(start));
  if (!found) return undefined;
  const offset = start + found.index;
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length + 1 };
}
