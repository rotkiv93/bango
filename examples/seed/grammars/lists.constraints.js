// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
return {
  ListModel(model, accept) {
    const seen = new Set();
    for (const list of model.lists) {
      if (seen.has(list.name)) accept('error', `duplicate list '${list.name}'`, { node: list, property: 'name' });
      seen.add(list.name);
    }
  },

  // columns and the sort field are fields of the entity
  ListDef(list, accept) {
    const entity = list.entity?.ref;
    const has = name => entity?.fields.some(f => f.name === name);
    const seen = new Set();
    list.columns.forEach((column, index) => {
      if (entity && !has(column.property)) {
        accept('error', `entity '${entity.name}' has no field '${column.property}'`, { node: column, property: 'property' });
      }
      if (seen.has(column.property)) accept('error', `column '${column.property}' is listed twice`, { node: list, property: 'columns', index });
      seen.add(column.property);
    });
    if (entity && list.sortBy !== undefined && !has(list.sortBy)) {
      accept('error', `cannot sort by '${list.sortBy}': entity '${entity.name}' has no such field`, { node: list, property: 'sortBy' });
    }
    if (list.pageSize !== undefined && list.pageSize < 1) {
      accept('error', 'pageSize must be at least 1', { node: list, property: 'pageSize' });
    }
  }
};
