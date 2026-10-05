// Import mapping: the inverse of datamodel.spec.js. Builds the data model from `data.dataModel`.
/** @type {Import} */
const importer = function (json, { n }) {
  const property = p => {
    // numeric keys that generate themselves are written `Long (autoinc)`
    const autoinc = /^(.*) \(autoinc\)$/.exec(p.class);
    return n('PropertyField', { name: p.name, class: autoinc ? autoinc[1] : p.class, autoinc: !!autoinc, required: p.required, pk: p.pk, unique: p.unique });
  };

  const relationship = p =>
    n('RelationshipField', { name: p.name, target: p.class, bidirectional: p.bidirectional, owner: p.owner, multiple: p.multiple, required: p.required });

  // only a relationship says who owns it
  const field = p => ('owner' in p ? relationship(p) : property(p));

  return n('Model', {
    entities: json.data.dataModel.entities.map(e => n('Entity', { name: e.name, displayString: e.displayString, fields: e.properties.map(field) }))
  });
};

return importer;
