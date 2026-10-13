// JSON mapping: the part of the product specification that security owns, `data.security`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName, typeName }) {
  // what a permission is about: the type of the node, as a word
  const kinds = { Entity: 'entity', FormDef: 'form', ListDef: 'list' };

  const role = r => {
    const out = { name: r.name };
    if (r.parents.length) out.parents = r.parents.map(refName);
    return out;
  };

  const user = u => {
    const out = { name: u.name };
    if (u.email !== undefined) out.email = u.email;
    out.roles = u.roles.map(refName);
    return out;
  };

  const permission = g => ({ role: refName(g.role), access: g.access, resource: refName(g.resource), kind: kinds[typeName(g.resource?.ref) ?? ''] });

  return {
    data: {
      security: {
        roles: model.roles.map(role),
        users: model.users.map(user),
        permissions: model.grants.map(permission)
      }
    }
  };
};

return spec;
