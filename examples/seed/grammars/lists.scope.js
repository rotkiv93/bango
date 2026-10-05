// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// The columns and the sort field of a list are fields of its entity. While the entity does not resolve (that is reported on its own),
// there is nothing to resolve them against.
/** @type {Scope} */
const scope = {
  ListDef: {
    sortBy: list => list.entity?.ref?.fields ?? []
  },
  ListColumn: {
    property: column => column.$container.entity?.ref?.fields ?? []
  }
};

return scope;
