import type { AstDto, JsonSpecOptions, JsonValue, RefDto } from '../types.js';

/**
 * The JSON spec of an instance: its configuration as plain data, free of parser details.
 *
 * - every node is an object: `$type`, then `name`, then its other values, references and children
 * - a reference is `{ "$ref": "Road", "$type": "Entity", "$in": "datamodel" }` (`$in`: the metamodel that declares
 *   the target), or `{ "$ref": "Nope", "$unresolved": true }`; with `refs: 'names'` it is just the name
 * - lists stay lists, empty lists are left out
 */
export function toJsonSpec(dto: AstDto, options: JsonSpecOptions = {}): JsonValue {
  const { refs = 'detailed', types = true, ranges = false } = options;

  const ref = (r: RefDto): JsonValue => {
    if (refs === 'names') return r.text;
    if (!r.resolved) return { $ref: r.text, $unresolved: true };
    return {
      $ref: r.text,
      ...(types && r.targetType ? { $type: r.targetType } : {}),
      ...(r.targetMetamodel ? { $in: r.targetMetamodel } : {})
    };
  };

  const many = <T,>(v: T | T[], f: (x: T) => JsonValue): JsonValue | undefined => {
    if (!Array.isArray(v)) return f(v);
    return v.length ? v.map(f) : undefined;
  };

  const node = (n: AstDto): JsonValue => {
    const out: { [key: string]: JsonValue } = {};
    if (types) out.$type = n.type;
    if (ranges && n.range) out.$range = [n.range.startLine, n.range.startColumn, n.range.endLine, n.range.endColumn];
    if (n.props.name !== undefined && n.props.name !== null) out.name = n.props.name as JsonValue;
    for (const [k, v] of Object.entries(n.props)) {
      if (k === 'name' || v === null) continue;
      if (Array.isArray(v) && !v.length) continue;
      out[k] = v as JsonValue;
    }
    for (const [k, v] of Object.entries(n.refs)) {
      const value = many(v, ref);
      if (value !== undefined) out[k] = value;
    }
    for (const [k, v] of Object.entries(n.children)) {
      const value = many(v, node);
      if (value !== undefined) out[k] = value;
    }
    return out;
  };

  return node(dto);
}

/**
 * Deep-merges JSON documents that describe different parts of one specification: objects are merged key by key,
 * arrays are concatenated, equal values are kept. Two different values for the same path are a conflict, because
 * each metamodel is supposed to own its own part.
 */
export function mergeJson(...docs: JsonValue[]): JsonValue {
  const merge = (a: JsonValue, b: JsonValue, path: string): JsonValue => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (isObject(a) && isObject(b)) {
      const out: { [key: string]: JsonValue } = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v, `${path}.${k}`) : v;
      return out;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) return a;
    throw new Error(`Cannot merge the specs: both define ${path || 'the root'} (${JSON.stringify(a)} and ${JSON.stringify(b)})`);
  };
  return docs.reduce((acc, d) => merge(acc, d, ''), {} as JsonValue);
}

const isObject = (v: JsonValue): v is { [key: string]: JsonValue } => typeof v === 'object' && v !== null && !Array.isArray(v);
