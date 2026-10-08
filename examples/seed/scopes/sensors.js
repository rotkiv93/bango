// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// A categorical dimension groups by a property of the sensor's fact table.
/** @type {Scope} */
const scope = {
  CategoricalDimension: {
    field: dimension => dimension.$container.factTable?.ref?.fields.filter(f => f.$type === 'PropertyField') ?? []
  }
};

return scope;
