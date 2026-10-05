// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  FormModel(model, accept) {
    for (const { item } of duplicates(model.forms, f => f.name)) accept('error', `duplicate form '${item.name}'`, { node: item, property: 'name' });
  },

  // the fields of a form are fields of its entity (forms.scope.js), each at most once
  FormDef(form, accept) {
    for (const { item, index } of duplicates(form.fields, f => refName(f.property))) {
      accept('error', `field '${refName(item.property)}' is listed twice`, { node: form, property: 'fields', index });
    }
  }
};

return constraints;
