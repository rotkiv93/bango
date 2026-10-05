// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  FormModel(model, accept) {
    for (const { item } of duplicates(model.forms, f => f.name)) accept('error', `duplicate form '${item.name}'`, { node: item, property: 'name' });
  },

  // the fields of a form are fields of its entity, each at most once
  FormDef(form, accept) {
    const entity = form.entity?.ref;
    for (const field of form.fields) {
      if (entity && !entity.fields.some(f => f.name === field.property)) {
        accept('error', `entity '${entity.name}' has no field '${field.property}'`, { node: field, property: 'property' });
      }
    }
    for (const { item, index } of duplicates(form.fields, f => f.property)) {
      accept('error', `field '${item.property}' is listed twice`, { node: form, property: 'fields', index });
    }
  }
};

return constraints;
