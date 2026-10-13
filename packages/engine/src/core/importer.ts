import type { ImportNode } from '@bango/composer';
import type { AstDto, FormSchema, ImportResult, InstanceState, JsonValue } from '@bango/core';
import { Printer } from '../editing/printer.js';
import { buildFormSchema, indexRules } from '../editing/schema.js';
import type { InstanceStore } from './instance-store.js';

const isNode = (v: unknown): v is ImportNode =>
  typeof v === 'object' && v !== null && typeof (v as ImportNode).$node === 'string' && typeof (v as ImportNode).fields === 'object';

/**
 * The tree an import mapping returned, as a node of the engine's own shape. What each feature is (text, a reference, a child) comes
 * from the grammar, so mappings only say `n('Entity', { name: 'Road', fields: [...] })`.
 */
function toDto(node: unknown, schema: FormSchema, where: string): AstDto {
  if (!isNode(node)) throw new Error(`${where}: expected n('Type', { ... }), got ${JSON.stringify(node) ?? String(node)}`);
  const type = schema.types[node.$node];
  if (!type) throw new Error(`${where}: there is no node type '${node.$node}' here (it has ${Object.keys(schema.types).join(', ')})`);
  const dto: AstDto = { type: node.$node, props: {}, refs: {}, children: {} };
  for (const [key, value] of Object.entries(node.fields)) {
    if (value === undefined || value === null) continue;
    const field = type.fields.find(f => f.name === key);
    if (!field) throw new Error(`${where}: '${node.$node}' has no feature '${key}' (it has ${type.fields.map(f => f.name).join(', ')})`);
    if (!field.many && Array.isArray(value)) throw new Error(`${where}: '${node.$node}.${key}' takes one value, not a list`);
    const values: unknown[] = field.many ? (Array.isArray(value) ? value : [value]) : [value];
    if (!values.length) continue;
    const at = `${where} > ${node.$node}.${key}`;
    switch (field.kind) {
      case 'child': {
        const children = values.map((v, i) => toDto(v, schema, field.many ? `${at}[${i}]` : at));
        dto.children[key] = field.many ? children : children[0];
        break;
      }
      case 'ref': {
        const refs = values.map(v => ({ text: String(v), resolved: false }));
        dto.refs[key] = field.many ? refs : refs[0];
        break;
      }
      case 'boolean':
        // a flag is a keyword that is there or is not
        if (value === true) dto.props[key] = true;
        break;
      default:
        dto.props[key] = (field.many ? values : values[0]) as AstDto['props'][string];
    }
  }
  return dto;
}

/**
 * Builds an instance text for every metamodel of the composition that has an import mapping, from the JSON of a whole project.
 * Changes nothing. `check` loads the texts the way they would be used and reports what each instance says.
 */
export async function importJson(
  store: InstanceStore,
  json: JsonValue,
  check: (texts: Record<string, string>) => Promise<InstanceState[]>
): Promise<ImportResult> {
  const result: ImportResult = { texts: {}, skipped: [], errors: [], problems: {} };
  if (!store.composition) return { ...result, errors: ['No composition loaded: compose the metamodels first'] };
  for (const [metamodel, { metamodel: m }] of store.languages) {
    if (!m.importer) { result.skipped.push(metamodel); continue; }
    try {
      // a copy each time: a mapping may reshape what it is given
      const tree = m.importer(JSON.parse(JSON.stringify(json)));
      const dto = toDto(tree, buildFormSchema(m.grammar, m.reflection), metamodel);
      result.texts[metamodel] = new Printer(indexRules(m.grammar)).print(dto, 0) + '\n';
    } catch (e) {
      result.errors.push(`The import mapping of '${metamodel}' failed: ${(e as Error).message}`);
    }
  }
  if (Object.keys(result.texts).length) {
    for (const state of await check(result.texts)) result.problems[state.metamodel] = state.problems;
  }
  return result;
}
