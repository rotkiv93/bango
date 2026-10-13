// Rules the grammar cannot express: unique names, and menus that stay usable.
/** @type {Constraints} */
const constraints = {
  MenuModel(model, accept) {
    for (const { item } of duplicates(model.menus, m => m.name)) accept('error', `duplicate menu '${item.name}'`, { node: item, property: 'name' });
  },

  Menu(menu, accept) {
    // every item of the menu, at any depth, with how deep it is
    const all = [];
    const walk = (items, depth) => items.forEach(item => { all.push({ item, depth }); if (item.items) walk(item.items, depth + 1); });
    walk(menu.items, 1);

    for (const { item } of duplicates(all, e => e.item.name)) {
      accept('error', `duplicate item '${item.item.name}' in menu '${menu.name}'`, { node: item.item, property: 'name' });
    }
    for (const { item, depth } of all) {
      if (depth > 3) accept('warning', `item '${item.name}' is ${depth} levels deep: a menu is hard to use beyond 3`, { node: item, property: 'name' });
      if (item.$type === 'MenuGroup' && !item.items.length) accept('warning', `group '${item.name}' has no items`, { node: item, property: 'name' });
    }
  }
};

return constraints;
