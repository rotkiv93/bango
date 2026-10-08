// JSON mapping: the part of the product specification that the lists own, `data.lists`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  const column = c => ({ name: refName(c.property), label: c.label ?? refName(c.property) });

  const list = l => {
    const out = { name: l.name, label: l.label ?? l.name, entity: refName(l.entity) };
    if (l.pageSize !== undefined) out.pageSize = l.pageSize;
    if (l.sortBy !== undefined) {
      out.sortBy = refName(l.sortBy);
      out.descending = !!l.descending;
    }
    // without a list of columns the list shows every field of the entity
    if (l.columns.length) out.columns = l.columns.map(column);
    return out;
  };

  return { data: { lists: model.lists.map(list) } };
};

return spec;
