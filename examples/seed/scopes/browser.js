// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// The fields of a form and the columns of a list are the fields of their entity, and of the entities it extends. While the entity does
// not resolve (that is reported on its own), there is nothing to resolve them against.
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
  FormField: {
    property: field => fieldsOf(field.$container.entity?.ref)
  },
  ListColumn: {
    property: column => fieldsOf(column.$container.entity?.ref)
  }
};

return scope;
