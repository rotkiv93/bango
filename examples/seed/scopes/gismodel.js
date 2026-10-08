// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// A layer draws a property of its entity (the constraint checks it holds a geometry).
/** @type {Scope} */
const scope = {
  GeoJsonLayer: {
    field: layer => layer.entity?.ref?.fields.filter(f => f.$type === 'PropertyField') ?? []
  }
};

return scope;
