// JSON mapping: the part of the product specification that the data model owns, `data.dataModel`.
// Merge it with the specs of the other metamodels to get the whole document.
return function (model) {
  // numeric keys that generate themselves are written `Long (autoinc)`
  const className = field => (field.autoinc ? `${field.class} (autoinc)` : field.class);

  const property = field => {
    const out = { name: field.name, class: className(field) };
    if (field.pk) out.pk = true;
    if (field.required) out.required = true;
    if (field.unique) out.unique = true;
    return out;
  };

  const relationship = field => {
    const out = { name: field.name, class: field.target.ref?.name ?? field.target.$refText, owner: !!field.owner };
    if (field.bidirectional) out.bidirectional = field.bidirectional;
    out.multiple = !!field.multiple;
    out.required = !!field.required;
    return out;
  };

  return {
    data: {
      dataModel: {
        entities: model.entities.map(entity => {
          const out = {
            name: entity.name,
            properties: entity.fields.map(field => (field.$type === 'PropertyField' ? property(field) : relationship(field)))
          };
          if (entity.displayString !== undefined) out.displayString = entity.displayString;
          return out;
        }),
        enums: []
      }
    }
  };
};
