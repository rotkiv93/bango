import { GrammarUtils, type AstNode, type AstReflection, type Grammar, type LangiumDocument } from 'langium';
import { toAstDto } from '@bango/composer';
import type { AstDto, EditOp, FormSchema, PathStep, RefCandidate, RefDto } from '../types.js';
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
  refCandidates(refType: string): RefCandidate[];
}

export function defaultDto(type: string, schema: FormSchema, refCandidates: EditContext['refCandidates'], depth = 0): AstDto {
  const dto: AstDto = { type, props: {}, refs: {}, children: {} };
  for (const f of schema.types[type]?.fields ?? []) {
    if (!f.required) continue;
    const one = (): unknown => {
      switch (f.kind) {
        case 'text': return f.name === 'name' ? `new${type}` : f.quoted ? '' : 'value';
        case 'number': return 0;
        case 'enum': return f.options?.[0] ?? '';
        case 'ref': return { text: refCandidates(f.refType ?? '')[0]?.name ?? 'TODO', resolved: false } satisfies RefDto;
        case 'child': return depth < 3 && f.childTypes?.[0] ? defaultDto(f.childTypes[0], schema, refCandidates, depth + 1) : undefined;
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

  const nodeAt = (path: PathStep[]): AstNode => {
    let n: AstNode = root;
    for (const s of path) {
      const v = (n as unknown as Record<string, unknown>)[s.feature];
      n = (s.index !== undefined ? (v as AstNode[])[s.index] : v) as AstNode;
      if (!n) throw new Error('The document changed, reload the form');
    }
    return n;
  };
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
      const child = defaultDto(type, schema, ctx.refCandidates);
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
        const first = ctx.refCandidates(field.refType ?? '')[0]?.name;
        listOf(dto.refs, op.feature).push({ text: op.value ?? first ?? 'TODO', resolved: false });
      } else {
        listOf(dto.props as Record<string, unknown[]>, op.feature).push(op.value ?? (field.kind === 'number' ? 0 : ''));
      }
    });
  }

  // remove
  if (op.feature !== undefined && op.index !== undefined) {
    const node = nodeAt(op.path);
    const field = fieldOf(node, op.feature);
    return reprint(node, dto => {
      const store = (field.kind === 'ref' ? dto.refs : field.kind === 'child' ? dto.children : dto.props) as Record<string, unknown[]>;
      listOf(store, op.feature!).splice(op.index!, 1);
    });
  }
  const node = nodeAt(op.path);
  if (node === root) throw new Error('The root element cannot be removed');
  let { start, end } = span(node);
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  if (start > 0 && text[start - 1] === '\n') start--;
  else if (text[end] === '\n') end++;
  return splice(start, end, '');
}
