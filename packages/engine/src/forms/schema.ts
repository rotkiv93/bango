import { GrammarAST as G, type AstReflection } from 'langium';
import type { FieldSchema, FormSchema } from '../types.js';

/** Rules of a language by the AST type they produce (rule name unless `returns` says otherwise). */
export function indexRules(grammar: G.Grammar): Map<string, G.ParserRule> {
  const rules = new Map<string, G.ParserRule>();
  for (const r of grammar.rules) {
    if (!G.isParserRule(r) || r.fragment) continue;
    rules.set(r.returnType?.ref?.name ?? r.name, r);
  }
  return rules;
}

export const isFragment = (r: unknown): r is G.ParserRule => G.isParserRule(r) && !!r.fragment;

interface Assignable { assignment: G.Assignment; optional: boolean }

/** Every assignment reachable from an element, following fragment calls. `optional` = may be absent in valid text. */
function collectAssignments(el: G.AbstractElement, optional: boolean, out: Assignable[], seen = new Set<G.ParserRule>()) {
  const opt = optional || el.cardinality === '?' || el.cardinality === '*';
  if (G.isAssignment(el)) out.push({ assignment: el, optional: opt });
  else if (G.isGroup(el) || G.isUnorderedGroup(el)) el.elements.forEach(e => collectAssignments(e, opt, out, seen));
  else if (G.isAlternatives(el)) el.elements.forEach(e => collectAssignments(e, true, out, seen));
  else if (G.isRuleCall(el)) {
    const rule = el.rule.ref;
    if (isFragment(rule) && !seen.has(rule)) collectAssignments(rule.definition, opt, out, new Set(seen).add(rule));
  }
}

function keywordsOf(el: G.AbstractElement): string[] | undefined {
  if (G.isKeyword(el)) return [el.value];
  if (G.isAlternatives(el)) {
    const all = el.elements.map(keywordsOf);
    return all.every(Boolean) ? all.flat() as string[] : undefined;
  }
  return undefined;
}

/** Rules that only pick between other rules (`Layer: A | B`), so they never appear as a node type themselves. */
function isAbstract(rule: G.ParserRule): boolean {
  const flat: G.AbstractElement[] = [];
  const walk = (e: G.AbstractElement) => (G.isAlternatives(e) || G.isGroup(e) ? e.elements.forEach(walk) : flat.push(e));
  walk(rule.definition);
  return flat.length > 0 && flat.every(e => G.isRuleCall(e) && G.isParserRule(e.rule.ref) && !e.rule.ref.fragment && !e.rule.ref.dataType);
}

/** A form description derived from a grammar: one entry per concrete node type, one field per assignment. */
export function buildFormSchema(grammar: G.Grammar, reflection: AstReflection): FormSchema {
  const rules = indexRules(grammar);
  const concrete = [...rules].filter(([, r]) => !isAbstract(r) && !r.dataType).map(([t]) => t);
  const concreteSubtypes = (type: string) => {
    const all = new Set([type, ...reflection.getAllSubTypes(type)]);
    return concrete.filter(t => all.has(t));
  };

  const schema: FormSchema = { root: '', types: {} };
  for (const [type, rule] of rules) {
    if (rule.entry) schema.root = type;
    if (isAbstract(rule) || rule.dataType) continue;
    const found: Assignable[] = [];
    collectAssignments(rule.definition, false, found);
    const fields = new Map<string, FieldSchema>();
    for (const { assignment: a, optional } of found) {
      if (fields.has(a.feature)) continue;
      const many = a.operator === '+=';
      const base = { name: a.feature, many, required: !optional && a.cardinality !== '?' && a.cardinality !== '*' };
      const t = a.terminal;
      let field: FieldSchema | undefined;
      if (a.operator === '?=') field = { ...base, kind: 'boolean', required: false };
      else if (G.isCrossReference(t)) {
        const refType = t.type.ref?.name ?? '';
        field = { ...base, kind: 'ref', refType };
      } else if (G.isRuleCall(t)) {
        const ref = t.rule.ref;
        if (G.isTerminalRule(ref)) {
          const isNumber = ref.type?.name === 'number';
          field = { ...base, kind: isNumber ? 'number' : 'text', quoted: ref.name === 'STRING' };
        } else if (G.isParserRule(ref) && ref.dataType) {
          field = { ...base, kind: ref.dataType === 'number' ? 'number' : 'text', quoted: false };
        } else if (G.isParserRule(ref)) {
          const name = ref.returnType?.ref?.name ?? ref.name;
          field = { ...base, kind: 'child', childTypes: concreteSubtypes(name) };
        }
      } else {
        const options = keywordsOf(t);
        if (options) field = { ...base, kind: 'enum', options };
      }
      if (field) fields.set(a.feature, field);
    }
    schema.types[type] = { type, fields: [...fields.values()] };
  }
  return schema;
}
