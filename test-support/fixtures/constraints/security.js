// Rules the grammar cannot express: unique names, roles that do not extend themselves, and permissions that make sense for what they
// point at (which may be declared in the data model, the forms or the lists).
/** @type {Constraints} */
const constraints = {
  SecurityModel(model, accept) {
    for (const { item } of duplicates(model.roles, r => r.name)) accept('error', `duplicate role '${item.name}'`, { node: item, property: 'name' });
    for (const { item } of duplicates(model.users, u => u.name)) accept('error', `duplicate user '${item.name}'`, { node: item, property: 'name' });
    for (const { item } of duplicates(model.grants, g => `${g.role?.$refText}|${g.access}|${g.resource?.$refText}`)) {
      accept('warning', `'${item.role?.$refText} ${item.access} on ${item.resource?.$refText}' is granted twice`, { node: item, property: 'access' });
    }

    // a role together with everything it extends
    const reach = role => {
      const seen = new Set();
      const walk = r => {
        if (!r || seen.has(r)) return;
        seen.add(r);
        r.parents.forEach(p => walk(p.ref));
      };
      walk(role);
      return seen;
    };

    for (const grant of model.grants) {
      const role = grant.role?.ref;
      const target = grant.resource?.ref;
      if (!role || !target) continue;

      // a list only shows data
      if (typeName(target) === 'ListDef' && grant.access !== 'read') {
        accept('warning', `a list can only be read, not '${grant.access}'`, { node: grant, property: 'access' });
      }

      // a form or a list works on an entity: whoever uses it needs access to that entity too
      const entity = 'entity' in target ? target.entity?.ref : undefined;
      if (entity) {
        const roles = reach(role);
        const allowed = model.grants.some(g => roles.has(g.role?.ref) && g.resource?.ref === entity);
        if (!allowed) {
          accept('warning', `role '${role.name}' can use '${target.name}' but has no access to its entity '${entity.name}'`, { node: grant, property: 'resource' });
        }
      }
    }
  },

  Role(role, accept) {
    for (const { item } of duplicates(role.parents, p => p.$refText)) {
      accept('warning', `role '${role.name}' extends '${item.$refText}' twice`, { node: role, property: 'parents' });
    }
    // a role cannot extend itself, however indirectly
    const seen = new Set();
    const pending = role.parents.map(p => p.ref);
    while (pending.length) {
      const next = pending.pop();
      if (!next) continue;
      if (next === role) {
        accept('error', `role '${role.name}' extends itself`, { node: role, property: 'parents' });
        return;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...next.parents.map(p => p.ref));
    }
  },

  User(user, accept) {
    for (const { item } of duplicates(user.roles, r => r.$refText)) {
      accept('warning', `user '${user.name}' has role '${item.$refText}' twice`, { node: user, property: 'roles' });
    }
  }
};

return constraints;
