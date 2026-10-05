// Import mapping: the inverse of lists.spec.js. Builds the lists from `data.lists`.
/** @type {Import} */
const importer = function (json, { n }) {
  // a label that is only the name is not written
  const label = (item, name) => (item.label !== name ? item.label : undefined);

  const column = c => n('ListColumn', { property: c.name, label: label(c, c.name) });

  const list = l =>
    n('ListDef', {
      name: l.name,
      label: label(l, l.name),
      entity: l.entity,
      pageSize: l.pageSize,
      sortBy: l.sortBy,
      descending: l.sortBy !== undefined ? l.descending : undefined,
      columns: l.columns?.map(column)
    });

  return n('ListModel', { lists: json.data.lists.map(list) });
};

return importer;
