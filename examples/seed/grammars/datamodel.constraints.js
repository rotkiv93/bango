// Extra rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  Entity(entity, accept) {
    const pks = entity.fields.filter(f => f.$type === 'PropertyField' && f.pk);
    if (pks.length !== 1) {
      accept('warning', `entity '${entity.name}' should have exactly one pk property (found ${pks.length})`, {
        node: entity,
        property: 'name'
      });
    }
    for (const { item, index } of duplicates(entity.fields, f => f.name)) {
      accept('error', `duplicate field '${item.name}'`, { node: entity, property: 'fields', index });
    }
  },

  // a bidirectional relationship needs the other side to exist, to point back, and to differ in ownership
  RelationshipField(field, accept) {
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
