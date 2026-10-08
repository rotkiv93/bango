// JSON mapping: the part of the product specification that the menus own, `data.menus` (the slot `basic` leaves empty).
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName, typeName }) {
  // what an item opens: the type of the node, as a word
  const kinds = { FormDef: 'form', ListDef: 'list', MapDef: 'map' };

  const item = i => {
    const out = { name: i.name, label: i.label ?? i.name };
    if (i.target) {
      out.type = kinds[typeName(i.target.ref) ?? ''];
      out.target = refName(i.target);
    }
    if (i.children.length) out.items = i.children.map(item);
    return out;
  };

  return { data: { menus: model.menus.map(m => ({ name: m.name, position: m.position ?? 'top', items: m.items.map(item) })) } };
};

return spec;
