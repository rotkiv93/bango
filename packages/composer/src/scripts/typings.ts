import type { Grammar } from 'langium';
import {
  collectAst,
  isArrayType,
  isInterfaceType,
  isPrimitiveType,
  isPropertyUnion,
  isReferenceType,
  isStringType,
  isValueType,
  type InterfaceType,
  type PropertyType,
  type UnionType
} from 'langium/grammar';

/** What every script sees, whatever the metamodel: the helpers, the node base type, and the shape of what scripts return. */
const PRELUDE = `/** A reference in an instance: \`ref\` is the node it points at (undefined when it does not resolve). */
interface Ref<T> { readonly ref?: T; readonly $refText: string }
interface AstNode {
  readonly $type: string;
  readonly $container?: AstNode;
  readonly $containerProperty?: string;
  readonly $containerIndex?: number;
}

/** Reports a problem on a node (or one of its properties). */
type Accept = (
  severity: 'error' | 'warning' | 'info' | 'hint',
  message: string,
  details?: { node?: AstNode; property?: string; index?: number; keyword?: string }
) => void;

interface Helpers {
  /** the name a reference points at: the target's name, or the text as written when it does not resolve */
  refName(ref: Ref<{ name?: string }> | undefined): string | undefined;
  /** the name of a node's type as its author wrote it (the same as \`node.$type\` unless the composer renamed the type) */
  typeName(node: AstNode | undefined): string | undefined;
  /** the items that repeat the key of an earlier one, with their index: \`duplicates(entity.fields, f => f.name)\` */
  duplicates<T>(items: readonly T[], key?: (item: T) => unknown): { item: T; index: number }[];
  /** import mappings: describe a node of the instance. Features are the properties of the node type; a reference is the name it points at, a child is another \`n(...)\`. */
  n<T extends keyof Types>(type: T, fields: Init<Types[T]>): ImportNode;
}

/** A node an import mapping describes: build it with \`n\`. */
interface ImportNode { readonly $node: string; readonly fields: Record<string, unknown> }
/** What a feature is given in an import mapping: text and numbers as they are, a reference as a name, a child as an \`n(...)\`. */
type Init<T> = { [K in keyof T as K extends \`$\${string}\` ? never : K]?: InitValue<T[K]> | null };
type InitValue<V> = V extends Ref<unknown> ? string : V extends readonly (infer I)[] ? InitValue<I>[] : V extends AstNode ? ImportNode : V;
declare const refName: Helpers['refName'];
declare const typeName: Helpers['typeName'];
declare const duplicates: Helpers['duplicates'];
declare const n: Helpers['n'];
`;

const quote = (s: string) => JSON.stringify(s);

function typeToString(type: PropertyType | undefined): string {
  if (!type) return 'unknown';
  if (isReferenceType(type)) return `Ref<${typeToString(type.referenceType)}>`;
  if (isArrayType(type)) {
    const element = typeToString(type.elementType);
    return /[|&]/.test(element) ? `(${element})[]` : `${element}[]`;
  }
  if (isPropertyUnion(type)) return type.types.map(typeToString).join(' | ') || 'never';
  if (isValueType(type)) return type.value.name;
  if (isPrimitiveType(type)) return type.primitive;
  if (isStringType(type)) return quote(type.string);
  return 'unknown';
}

function interfaceToString(type: InterfaceType): string {
  const supers = [...type.superTypes].filter(isInterfaceType).map(s => s.name);
  const lines = [`  readonly $type: ${[...type.typeNames].sort().map(quote).join(' | ') || quote(type.name)};`];
  // lists are always there (possibly empty), whatever the cardinality in the grammar
  for (const p of type.properties) lines.push(`  readonly ${p.name}${p.optional && !isArrayType(p.type) ? '?' : ''}: ${typeToString(p.type)};`);
  return `interface ${type.name} extends ${supers.length ? supers.join(', ') : 'AstNode'} {\n${lines.join('\n')}\n}`;
}

const unionToString = (type: UnionType) => `type ${type.name} = ${typeToString(type.type)};`;

/**
 * TypeScript declarations for the scripts of a metamodel (constraints and JSON mapping), from its grammar: one interface per
 * AST type with its properties, plus `Constraints` and `Spec`, the shapes the two kinds of script return. Loaded into an
 * editor next to a script, they give it completion and checks:
 *
 *     /** @type {Constraints} *\/
 *     const constraints = { Entity(entity, accept) { entity.fields } };
 *
 * `flat` is the grammar with its imports inlined (what the metamodel is parsed with). `root` is the type of its entry rule.
 */
export function generateTypings(flat: Grammar | undefined, root?: string): string {
  let interfaces: InterfaceType[] = [];
  let unions: UnionType[] = [];
  try {
    if (flat) ({ interfaces, unions } = collectAst(flat));
  } catch {
    // a grammar too broken to type: the scripts still get the helpers
  }
  interfaces.sort((a, b) => a.name.localeCompare(b.name));
  unions.sort((a, b) => a.name.localeCompare(b.name));
  const rootType = root ?? 'AstNode';
  const keyed = [...interfaces, ...unions].map(t => t.name);
  return [
    PRELUDE,
    ...interfaces.map(interfaceToString),
    ...unions.map(unionToString),
    '',
    '/** The node types by name: what `n` takes. */',
    `interface Types {\n${interfaces.map(i => `  ${i.name}: ${i.name};`).join('\n')}\n}`,
    '',
    '/** What `constraints.js` returns: validation checks keyed by AST type name. */',
    `interface Constraints {\n${keyed.map(n => `  ${n}?(node: ${n}, accept: Accept): void;`).join('\n')}\n}`,
    '',
    '/** What the JSON mapping returns: a function of the instance root, or `{ root: true, map }` for the mapping that lays out the whole document. */',
    `type Spec = ((model: ${rootType}, helpers: Helpers) => unknown) | { root?: boolean; map(model: ${rootType}, helpers: Helpers): unknown };`,
    '',
    '/** What `import.js` returns: the inverse of the JSON mapping. It gets the whole project document and describes the instance of this metamodel with `n`. */',
    'type Import = (json: any, helpers: Helpers) => ImportNode;',
    ''
  ].join('\n');
}
