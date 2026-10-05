// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
/** @type {Constraints} */
const constraints = {
  ListModel(model, accept) {
    for (const { item } of duplicates(model.lists, l => l.name)) accept('error', `duplicate list '${item.name}'`, { node: item, property: 'name' });
  },

  // columns and the sort field are fields of the entity
  ListDef(list, accept) {
    const entity = list.entity?.ref;
    const has = name => entity?.fields.some(f => f.name === name);
    for (const column of list.columns) {
      if (entity && !has(column.property)) {
        accept('error', `entity '${entity.name}' has no field '${column.property}'`, { node: column, property: 'property' });
      }
    }
    for (const { item, index } of duplicates(list.columns, c => c.property)) {
      accept('error', `column '${item.property}' is listed twice`, { node: list, property: 'columns', index });
    }
    if (entity && list.sortBy !== undefined && !has(list.sortBy)) {
      accept('error', `cannot sort by '${list.sortBy}': entity '${entity.name}' has no such field`, { node: list, property: 'sortBy' });
    }
    if (list.pageSize !== undefined && list.pageSize < 1) {
      accept('error', 'pageSize must be at least 1', { node: list, property: 'pageSize' });
    }
  }
};

return constraints;
