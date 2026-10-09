// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  BrowserModel(model, accept) {
    for (const { item } of duplicates(model.forms, f => f.name)) accept('error', `duplicate form '${item.name}'`, { node: item, property: 'name' });
    for (const { item } of duplicates(model.lists, l => l.name)) accept('error', `duplicate list '${item.name}'`, { node: item, property: 'name' });
    // a form per entity: the lists open the form of their entity
    for (const { item } of duplicates(model.forms, f => refName(f.entity))) {
      accept('warning', `entity '${refName(item.entity)}' already has a form`, { node: item, property: 'entity' });
    }
  },

  // the fields of a form are fields of its entity (browser.scope.js), each at most once
  FormDef(form, accept) {
    for (const { item, index } of duplicates(form.fields, f => refName(f.property))) {
      accept('error', `field '${refName(item.property)}' is listed twice`, { node: form, property: 'fields', index });
    }
  },

  // the columns are fields of the entity, each at most once; the form a list opens is the form of its entity
  ListDef(list, accept) {
    for (const { item, index } of duplicates(list.columns, c => refName(c.property))) {
      accept('error', `column '${refName(item.property)}' is listed twice`, { node: list, property: 'columns', index });
    }
    const form = list.form?.ref;
    if (form && list.entity?.ref && form.entity?.ref && form.entity.ref !== list.entity.ref) {
      accept('error', `form '${form.name}' is a form of '${form.entity.$refText}', not of '${list.entity.$refText}'`, { node: list, property: 'form' });
    }
    if (list.removeLink && !form) {
      accept('warning', `list '${list.name}' has a remove link but no form to remove from`, { node: list, property: 'removeLink' });
    }
  }
};

return constraints;
