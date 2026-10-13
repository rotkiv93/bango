// Import mapping: the inverse of security.spec.js. Builds the security instance from `data.security`.
/** @type {Import} */
const importer = function (json, { n }) {
  const s = json.data.security;
  return n('SecurityModel', {
    roles: s.roles.map(r => n('Role', { name: r.name, parents: r.parents })),
    users: s.users.map(u => n('User', { name: u.name, email: u.email, roles: u.roles })),
    grants: s.permissions.map(g => n('Grant', { role: g.role, access: g.access, resource: g.resource }))
  });
};

return importer;
