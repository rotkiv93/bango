// Rules the grammar cannot express: unique names, items that do something, and menus that stay usable.
/** @type {Constraints} */
const constraints = {
  MenuModel(model, accept) {
    for (const { item } of duplicates(model.menus, m => m.name)) accept('error', `duplicate menu '${item.name}'`, { node: item, property: 'name' });
  },

  Menu(menu, accept) {
    // every item of the menu, at any depth, with how deep it is
    const all = [];
    const walk = (items, depth) => items.forEach(item => { all.push({ item, depth }); walk(item.children, depth + 1); });
    walk(menu.items, 1);

    for (const { item } of duplicates(all, e => e.item.name)) {
      accept('error', `duplicate item '${item.item.name}' in menu '${menu.name}'`, { node: item.item, property: 'name' });
    }
    for (const { item, depth } of all) {
      if (depth > 3) accept('warning', `item '${item.name}' is ${depth} levels deep: a menu is hard to use beyond 3`, { node: item, property: 'name' });
      if (!item.target && !item.children.length) accept('warning', `item '${item.name}' opens nothing and has no items`, { node: item, property: 'name' });
    }
    // two ways to the same screen are rarely meant
    for (const { item } of duplicates(all.filter(e => e.item.target?.ref), e => e.item.target?.ref)) {
      accept('hint', `'${item.item.target?.$refText}' is already opened by another item of '${menu.name}'`, { node: item.item, property: 'target' });
    }
  }
};

return constraints;
