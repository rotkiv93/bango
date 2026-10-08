// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  ListModel(model, accept) {
    for (const { item } of duplicates(model.lists, l => l.name)) accept('error', `duplicate list '${item.name}'`, { node: item, property: 'name' });
  },

  // columns and the sort field are fields of the entity (lists.scope.js), each column at most once
  ListDef(list, accept) {
    for (const { item, index } of duplicates(list.columns, c => refName(c.property))) {
      accept('error', `column '${refName(item.property)}' is listed twice`, { node: list, property: 'columns', index });
    }
    if (list.pageSize !== undefined && list.pageSize < 1) {
      accept('error', 'pageSize must be at least 1', { node: list, property: 'pageSize' });
    }
  }
};

return constraints;
