// Extra rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.

// Names the generated database and code cannot use as the name of an entity or an enumeration (checked as snake_case for the database)
const POSTGRES = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case", "cast", "check", "collate",
  "column", "constraint", "create", "current_catalog", "current_date", "current_role", "current_time", "current_timestamp",
  "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign",
  "from", "grant", "group", "having", "in", "initially", "intersect", "into", "lateral", "leading", "limit", "localtime",
  "localtimestamp", "not", "null", "offset", "on", "only", "or", "order", "placing", "primary", "references", "returning",
  "select", "session_user", "some", "symmetric", "table", "then", "to", "trailing", "true", "union", "unique", "user", "using",
  "variadic", "when", "where", "window", "with"
]);
const JAVA = new Set([
  "abstract", "continue", "for", "new", "switch", "assert", "default", "goto", "package", "synchronized", "boolean", "do", "if",
  "private", "this", "break", "double", "implements", "protected", "throw", "byte", "else", "import", "public", "throws", "case",
  "enum", "instanceof", "return", "transient", "catch", "extends", "int", "short", "try", "char", "final", "interface", "static",
  "void", "class", "finally", "long", "strictfp", "volatile", "const", "float", "native", "super", "while"
]);

const TEXT = new Set(['String', 'Text']);
const NUMBER = new Set(['Integer', 'Long', 'Float', 'Double']);
const PATTERNS = ['IP', 'URL', 'Email'];

const snake = name => name.replace(/\w([A-Z])/g, m => m[0] + '_' + m[1].toLowerCase()).toLowerCase();
const reserved = name => POSTGRES.has(snake(name)) || JAVA.has(name);

// the entity, then the one it extends, and so on; stops where it would come back to one it has
const lineage = entity => {
  const chain = [];
  for (let e = entity; e && !chain.includes(e); e = e.superclass?.ref) chain.push(e);
  return chain;
};

/** @type {Constraints} */
const constraints = {
  Model(model, accept) {
    for (const { item } of duplicates([...model.entities, ...model.enums], e => e.name)) {
      accept('error', `'${item.name}' is declared twice (entities and enumerations share their names)`, { node: item, property: 'name' });
    }
  },

  EnumDef(enumeration, accept) {
    if (reserved(enumeration.name)) {
      accept('warning', `'${enumeration.name}' is a reserved word of the database or of Java`, { node: enumeration, property: 'name' });
    }
    enumeration.values.forEach((value, index) => {
      if (enumeration.values.indexOf(value) !== index) {
        accept('error', `duplicate value '${value}'`, { node: enumeration, property: 'values', index });
      }
    });
  },

  Entity(entity, accept) {
    if (reserved(entity.name)) {
      accept('warning', `'${entity.name}' is a reserved word of the database or of Java`, { node: entity, property: 'name' });
    }

    const chain = lineage(entity);
    const last = chain[chain.length - 1];
    if (last.superclass?.ref && chain.includes(last.superclass.ref)) {
      accept('error', `'${entity.name}' extends itself, through '${last.name}'`, { node: entity, property: 'superclass' });
    }

    const pks = entity.fields.filter(f => f.$type === 'PropertyField' && f.pk);
    if (!entity.superclass) {
      // the root of a hierarchy has the key
      if (pks.length !== 1) {
        accept('warning', `entity '${entity.name}' should have exactly one pk property (found ${pks.length})`, { node: entity, property: 'name' });
      }
    } else if (pks.length > 0) {
      accept('warning', `entity '${entity.name}' extends '${entity.superclass.$refText}', so it already has a pk`, { node: entity, property: 'name' });
    }

    for (const { item, index } of duplicates(entity.fields, f => f.name)) {
      accept('error', `duplicate field '${item.name}'`, { node: entity, property: 'fields', index });
    }

    // a subclass cannot say again what the entities above it have
    const above = new Set(chain.slice(1).flatMap(e => e.fields.map(f => f.name)));
    entity.fields.forEach((field, index) => {
      if (above.has(field.name)) {
        accept('error', `'${field.name}' is already a field of an entity '${entity.name}' extends`, { node: entity, property: 'fields', index });
      }
    });
  },

  PropertyField(field, accept) {
    // an enumeration is a type of its own: patterns and limits are not for it
    const type = field.class ?? 'enumeration';
    if ((field.patternType !== undefined || field.pattern !== undefined) && !TEXT.has(type)) {
      accept('error', `a pattern only limits a String or a Text, not a ${type}`, { node: field, property: field.pattern !== undefined ? 'pattern' : 'patternType' });
    }
    if (field.patternType !== undefined && !PATTERNS.includes(field.patternType)) {
      accept('error', `'${field.patternType}' is not a pattern: use ${PATTERNS.join(', ')} or a regular expression in quotes`, { node: field, property: 'patternType' });
    }
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern);
      } catch {
        accept('error', `'${field.pattern}' is not a regular expression`, { node: field, property: 'pattern' });
      }
    }
    if ((field.min !== undefined || field.max !== undefined) && !TEXT.has(type) && !NUMBER.has(type)) {
      accept('error', `min and max limit the length of a String or the value of a number, not a ${type}`, { node: field, property: field.min !== undefined ? 'min' : 'max' });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      accept('error', `min ${field.min} is more than max ${field.max}`, { node: field, property: 'min' });
    }
    if (TEXT.has(type) && field.min !== undefined && field.min < 0) {
      accept('error', 'the length of a text cannot be negative', { node: field, property: 'min' });
    }
    if (TEXT.has(type) && field.max !== undefined && field.max < 1) {
      accept('error', 'a text must be allowed at least 1 character', { node: field, property: 'max' });
    }
  },

  // a bidirectional relationship needs the other side to exist, to point back, and to differ in ownership
  RelationshipField(field, accept) {
    // `item` is what the generated lists call one row
    if (field.name === 'item' || reserved(field.name)) {
      accept('warning', `'${field.name}' is a reserved word of the database or of Java`, { node: field, property: 'name' });
    }
    if (!field.bidirectional) return;
    const target = field.target.ref;
    if (!target) return;
    const other = target.fields.filter(f => f.$type === 'RelationshipField').find(f => f.name === field.bidirectional);
    if (!other) {
      accept('error', `'${target.name}' has no relationship '${field.bidirectional}' to be the other side of '${field.name}'`, {
        node: field,
        property: 'bidirectional'
      });
      return;
    }
    if (other.bidirectional !== field.name) {
      accept('error', `'${target.name}.${other.name}' should name '${field.name}' as its inverse`, { node: field, property: 'bidirectional' });
    }
    if (!!other.owner === !!field.owner) {
      accept('error', `exactly one side of '${field.name}' and '${target.name}.${other.name}' must be the owner`, { node: field, property: 'name' });
    }
  }
};

return constraints;
