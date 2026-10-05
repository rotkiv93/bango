// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
return {
  FormModel(model, accept) {
    const seen = new Set();
    for (const form of model.forms) {
      if (seen.has(form.name)) accept('error', `duplicate form '${form.name}'`, { node: form, property: 'name' });
      seen.add(form.name);
    }
  },

  // the fields of a form are fields of its entity, each at most once
  FormDef(form, accept) {
    const entity = form.entity?.ref;
    const seen = new Set();
    form.fields.forEach((field, index) => {
      if (entity && !entity.fields.some(f => f.name === field.property)) {
        accept('error', `entity '${entity.name}' has no field '${field.property}'`, { node: field, property: 'property' });
      }
      if (seen.has(field.property)) accept('error', `field '${field.property}' is listed twice`, { node: form, property: 'fields', index });
      seen.add(field.property);
    });
  }
};
