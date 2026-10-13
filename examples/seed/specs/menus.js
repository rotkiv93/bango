// JSON mapping: the part of the product specification that the menus own, `data.menus` (the slot `basic` leaves empty).
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model) {
  // a name written in quotes comes with them
  const unq = text => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text);

  const access = a => {
    if (!a) return undefined;
    const out = {};
    if (a.admin) out.admin = true;
    if (a.logged) out.logged = true;
    if (a.anonymous) out.anonymous = true;
    return out;
  };

  const item = i => {
    const out = { id: unq(i.name) };
    if (i.$type === 'MenuGroup') {
      out.type = 'MENU';
      out.elements = i.items.map(item);
    } else {
      out.type = 'VIEW';
      out.view = { component: i.component, view: i.view };
    }
    const who = access(i.access);
    if (who) out.access = who;
    return out;
  };

  return { data: { menus: model.menus.map(m => ({ id: unq(m.name), elements: m.items.map(item) })) } };
};

return spec;
