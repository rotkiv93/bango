import { AstUtils, isAstNode, isReference, type AstNode, type LangiumDocument, type Reference } from 'langium';
import type { AstDto, RefDto } from './types.js';

type Primitive = string | number | boolean | null;

/** Instances live at `memory:/<metamodel>.<extension>`. */
export const metamodelOfDocument = (doc: LangiumDocument) => metamodelOfPath(doc.uri.path);
export const metamodelOfPath = (path: string) => decodeURIComponent(path.replace(/^\//, '')).replace(/\.[^.]+$/, '');

function refToDto(ref: Reference): RefDto {
  let target: AstNode | undefined;
  try { target = ref.ref; } catch { /* unresolvable */ }
  if (!target) return { text: ref.$refText, resolved: false };
  const named = (target as { name?: unknown }).name;
  return {
    text: ref.$refText,
    resolved: true,
    targetType: target.$type,
    targetName: typeof named === 'string' ? named : undefined,
    targetMetamodel: metamodelOfDocument(AstUtils.getDocument(target))
  };
}

/** Generic serialisation of any Langium AST, driven by the node's own properties (so it works for every metamodel). */
export function toAstDto(node: AstNode): AstDto {
  const dto: AstDto = { type: node.$type, props: {}, refs: {}, children: {} };
  const range = node.$cstNode?.range;
  if (range) {
    dto.range = {
      startLine: range.start.line, startColumn: range.start.character,
      endLine: range.end.line, endColumn: range.end.character
    };
  }
  const name = (node as { name?: unknown }).name;
  if (typeof name === 'string') dto.name = name;

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (Array.isArray(value)) {
      if (value.length && value.every(isReference)) dto.refs[key] = value.map(refToDto);
      else if (value.length && value.every(isAstNode)) dto.children[key] = value.map(toAstDto);
      else dto.props[key] = value.filter((v): v is Primitive => !isAstNode(v) && !isReference(v)).map(v => (typeof v === 'bigint' ? String(v) : v));
    } else if (isReference(value)) {
      dto.refs[key] = refToDto(value);
    } else if (isAstNode(value)) {
      dto.children[key] = toAstDto(value);
    } else if (value !== undefined) {
      dto.props[key] = typeof value === 'bigint' ? String(value) : (value as Primitive);
    }
  }
  return dto;
}
