// Import mapping: the inverse of menus.spec.js. Builds the menus from `data.menus`; items nest as deep as the JSON does.
/** @type {Import} */
const importer = function (json, { n }) {
  // a name that is not a plain word is written in quotes (its uses are written the same way)
  const q = text => (text === undefined ? undefined : /^[_a-zA-Z][\w-]*$/.test(text) ? text : JSON.stringify(text));

  const access = a => (a ? n('MenuAccess', { admin: a.admin, logged: a.logged, anonymous: a.anonymous }) : undefined);

  const item = i => {
    if (i.type === 'MENU') return n('MenuGroup', { name: q(i.id), access: access(i.access), items: (i.elements ?? []).map(item) });
    const view = i.view ?? {};
    return n('MenuView', { name: q(i.id), component: view.component, view: view.view, access: access(i.access) });
  };

  return n('MenuModel', { menus: (json.data.menus ?? []).map(m => n('Menu', { name: q(m.id), items: (m.elements ?? []).map(item) })) });
};

return importer;
