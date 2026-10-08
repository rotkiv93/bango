// Import mapping: the inverse of menus.spec.js. Builds the menus from `data.menus`; items nest as deep as the JSON does.
/** @type {Import} */
const importer = function (json, { n }) {
  // a label that is only the name is not written
  const item = i =>
    n('MenuItem', { name: i.name, label: i.label !== i.name ? i.label : undefined, target: i.target, children: i.items?.map(item) });

  return n('MenuModel', {
    menus: json.data.menus.map(m => n('Menu', { name: m.name, position: m.position !== 'top' ? m.position : undefined, items: m.items.map(item) }))
  });
};

return importer;
