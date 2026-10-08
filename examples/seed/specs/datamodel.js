// JSON mapping: the part of the product specification that the data model owns, `data.dataModel`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model) {
  // numeric keys that generate themselves are written `Long (autoinc)`; the class of a property is a basic type or the name of an enumeration
  const typeName = field => field.class ?? field.enumType?.ref?.name ?? field.enumType?.$refText;
  const className = field => (field.autoinc ? `${typeName(field)} (autoinc)` : typeName(field));

  const property = field => {
    const out = { name: field.name, class: className(field) };
    if (field.pk) out.pk = true;
    if (field.required) out.required = true;
    if (field.unique) out.unique = true;
    // a regular expression of one's own is a "Personalizado" pattern
    if (field.patternType !== undefined) out.patternType = field.patternType;
    if (field.pattern !== undefined) {
      out.patternType = 'Personalizado';
      out.pattern = field.pattern;
    }
    if (field.min !== undefined) out.min = field.min;
    if (field.max !== undefined) out.max = field.max;
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
          if (entity.superclass) out.superclass = entity.superclass.ref?.name ?? entity.superclass.$refText;
          if (entity.abstract) out.abstract = true;
          if (entity.traceable) out.traceable = true;
          return out;
        }),
        enums: model.enums.map(enumeration => ({ name: enumeration.name, values: [...enumeration.values] }))
      }
    }
  };
};

return spec;
