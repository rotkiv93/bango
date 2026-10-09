// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// A layer draws a property of its entity (the constraint checks it holds a geometry).
// the fields of an entity: its own and those of the entities it extends
const fieldsOf = entity => {
  const out = [];
  for (let e = entity, seen = []; e && !seen.includes(e); e = e.superclass?.ref) {
    seen.push(e);
    out.push(...e.fields);
  }
  return out;
};

/** @type {Scope} */
const scope = {
  GeoJsonLayer: {
    field: layer => fieldsOf(layer.entity?.ref).filter(f => f.$type === 'PropertyField')
  }
};

return scope;
