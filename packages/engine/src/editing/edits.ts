import { GrammarUtils, type AstNode, type AstReflection, type Grammar, type LangiumDocument } from 'langium';
import { toAstDto } from '@bango/composer';
import type { AstDto, EditOp, FormSchema, PathStep, RefCandidate, RefDto } from '@bango/core';
import { Printer } from './printer.js';
import { buildFormSchema, indexRules } from './schema.js';

export interface EditContext {
  /** current text of the instance */
  text: string;
  /** the parsed instance */
  doc: LangiumDocument;
  /** the metamodel's flattened grammar */
  grammar: Grammar;
  reflection: AstReflection;
  /** candidates for a reference of the given type (used to pick sensible defaults) */
  refCandidates(refType: string, at?: RefSite): RefCandidate[];
}

/** Where a reference is going to be written: the node that holds it (possibly not created yet) and its feature. */
export interface RefSite {
  node: { $type: string; $container?: unknown; $containerProperty?: string };
  feature: string;
}

/** The node an instance path leads to. */
export function nodeAtPath(root: AstNode, path: PathStep[]): AstNode {
  let n: AstNode = root;
  for (const s of path) {
    const v = (n as unknown as Record<string, unknown>)[s.feature];
    n = (s.index !== undefined ? (v as AstNode[])[s.index] : v) as AstNode;
    if (!n) throw new Error('The document changed, reload the form');
  }
  return n;
}

export function defaultDto(type: string, schema: FormSchema, refCandidates: EditContext['refCandidates'], depth = 0, at?: { container?: RefSite['node']; feature?: string }): AstDto {
  const dto: AstDto = { type, props: {}, refs: {}, children: {} };
  // the node as far as a scope script can tell: its type, and where it will be
  const self = { $type: type, $container: at?.container, $containerProperty: at?.feature };
  for (const f of schema.types[type]?.fields ?? []) {
    if (!f.required) continue;
    const one = (): unknown => {
      switch (f.kind) {
        case 'text': return f.name === 'name' ? `new${type}` : f.quoted ? '' : f.sample ?? 'value';
        case 'number': return 0;
        case 'enum': return f.options?.[0] ?? '';
        case 'ref': return { text: refCandidates(f.refType ?? '', { node: self, feature: f.name })[0]?.name ?? 'TODO', resolved: false } satisfies RefDto;
        case 'child': return depth < 3 && f.childTypes?.[0] ? defaultDto(f.childTypes[0], schema, refCandidates, depth + 1, { container: self, feature: f.name }) : undefined;
        default: return undefined;
      }
    };
    const v = one();
    if (v === undefined) continue;
    const target = (f.kind === 'ref' ? dto.refs : f.kind === 'child' ? dto.children : dto.props) as Record<string, unknown>;
    target[f.name] = f.many ? [v] : v;
  }
  return dto;
}

/**
 * Applies a form edit to the text of an instance and returns the new text. Changing an existing value is a surgical
 * replacement (comments and layout survive); structural changes reprint only the affected node from its grammar rule.
 */
export function applyEditToText(ctx: EditContext, op: EditOp): string {
  const { text, doc } = ctx;
  const schema = buildFormSchema(ctx.grammar, ctx.reflection);
  const printer = new Printer(indexRules(ctx.grammar));
  const root = doc.parseResult.value;

  const nodeAt = (path: PathStep[]) => nodeAtPath(root, path);
  const span = (n: AstNode) => {
    const cst = n.$cstNode;
    if (!cst) throw new Error('Node has no source position');
    return { start: cst.offset, end: cst.end };
  };
  const splice = (start: number, end: number, replacement: string) => text.slice(0, start) + replacement + text.slice(end);
  const levelOf = (n: AstNode) => {
    const { start } = span(n);
    let i = text.lastIndexOf('\n', start - 1) + 1;
    let width = 0;
    while (text[i] === ' ' || text[i] === '\t') { i++; width++; }
    return Math.floor(width / 2);
  };
  const reprint = (n: AstNode, mutate: (dto: AstDto) => void) => {
    const dto = toAstDto(n);
    mutate(dto);
    const { start, end } = span(n);
    return splice(start, end, printer.print(dto, levelOf(n)));
  };
  const fieldOf = (n: AstNode, name: string) => {
    const f = schema.types[n.$type]?.fields.find(x => x.name === name);
    if (!f) throw new Error(`${n.$type} has no field '${name}'`);
    return f;
  };
  const listOf = <T,>(rec: Record<string, T | T[]>, key: string): T[] => {
    const cur = rec[key];
    const arr = cur === undefined ? [] : Array.isArray(cur) ? cur : [cur];
    rec[key] = arr;
    return arr;
  };

  if (op.kind === 'set') {
    const node = nodeAt(op.path);
    const field = fieldOf(node, op.feature);
    const empty = op.value === null || op.value === '';
    // fast path: replace just the existing value token
    if (!empty && field.kind !== 'boolean' && field.kind !== 'child') {
      const cst = GrammarUtils.findNodesForProperty(node.$cstNode, op.feature)[op.index ?? 0];
      if (cst) {
        const raw = field.quoted ? JSON.stringify(String(op.value)) : String(op.value);
        return splice(cst.offset, cst.end, raw);
      }
    }
    return reprint(node, dto => {
      const store = (field.kind === 'ref' ? dto.refs : dto.props) as Record<string, unknown>;
      if (empty || (field.kind === 'boolean' && op.value === false)) {
        if (op.index !== undefined) listOf(store as Record<string, unknown[]>, op.feature).splice(op.index, 1);
        else delete store[op.feature];
        return;
      }
      const v = field.kind === 'ref' ? ({ text: String(op.value), resolved: false } satisfies RefDto) : op.value;
      if (op.index !== undefined) listOf(store as Record<string, unknown[]>, op.feature)[op.index] = v;
      else store[op.feature] = v;
    });
  }

  if (op.kind === 'add') {
    const node = nodeAt(op.path);
    const field = fieldOf(node, op.feature);
    if (field.kind === 'child') {
      const type = op.type ?? field.childTypes?.[0];
      if (!type) throw new Error(`No node type can be created for '${op.feature}'`);
      const child = defaultDto(type, schema, ctx.refCandidates, 0, { container: node, feature: op.feature });
      if (node === root && field.many) {
        // top-level element: append instead of reprinting the whole file (keeps comments and layout)
        return text.trimEnd() + '\n' + printer.print(child, 0) + '\n';
      }
      return reprint(node, dto => {
        if (field.many) listOf(dto.children, op.feature).push(child);
        else dto.children[op.feature] = child;
      });
    }
    return reprint(node, dto => {
      if (field.kind === 'ref') {
        const first = ctx.refCandidates(field.refType ?? '', { node, feature: op.feature })[0]?.name;
        listOf(dto.refs, op.feature).push({ text: op.value ?? first ?? 'TODO', resolved: false });
      } else {
        listOf(dto.props as Record<string, unknown[]>, op.feature).push(op.value ?? (field.kind === 'number' ? 0 : ''));
      }
    });
  }

  // remove
  /** What the grammar requires cannot be removed: the text would no longer be text of the language. */
  const mustKeep = (parent: AstNode, feature: string, count: number) => {
    const field = fieldOf(parent, feature);
    if (!field.required) return;
    if (field.many && count > 1) return;
    throw new Error(field.many ? `'${parent.$type}' needs at least one '${feature}'` : `'${parent.$type}' needs a '${feature}'`);
  };
  if (op.feature !== undefined && op.index !== undefined) {
    const node = nodeAt(op.path);
    const field = fieldOf(node, op.feature);
    const items = (node as unknown as Record<string, unknown>)[op.feature];
    if (field.kind === 'child' || field.kind === 'ref' || field.many) mustKeep(node, op.feature, Array.isArray(items) ? items.length : 1);
    return reprint(node, dto => {
      const store = (field.kind === 'ref' ? dto.refs : field.kind === 'child' ? dto.children : dto.props) as Record<string, unknown[]>;
      listOf(store, op.feature!).splice(op.index!, 1);
    });
  }
  const node = nodeAt(op.path);
  if (node === root) throw new Error('The root element cannot be removed');
  if (node.$container && node.$containerProperty) {
    const parent = node.$container;
    const feature = node.$containerProperty;
    const siblings = (parent as unknown as Record<string, unknown>)[feature];
    const count = Array.isArray(siblings) ? siblings.length : 1;
    mustKeep(parent, feature, count);
    // the last child of a node that is not the root: what surrounds it (`{ ... }`) goes with it, so the parent is printed again
    if (count === 1 && parent !== root) {
      return reprint(parent, dto => { delete dto.children[feature]; });
    }
  }
  let { start, end } = span(node);
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  if (start > 0 && text[start - 1] === '\n') start--;
  else if (text[end] === '\n') end++;
  return splice(start, end, '');
}
