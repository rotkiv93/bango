// JSON mapping: the parts of the product specification that the lists and forms own, `data.forms` and `data.lists`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  // a name written in quotes comes with them
  const unq = text => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text);

  // the entity that declares a field, which may be one the form's entity extends
  const ownerOf = (reference, entity) => reference.ref?.$container?.name ?? entity;

  const form = f => {
    const entity = refName(f.entity);
    const out = { id: unq(f.name), entity };
    if (f.abstract) out.abstract = true;
    out.creatable = !!f.allowCreate;
    out.editable = !!f.allowEdit;
    out.removable = !!f.allowRemove;
    out.confirmation = !!f.confirmRemove;
    out.properties = f.fields.map(field => ({ property: refName(field.property), viewing: !!field.viewed, editing: !!field.edited, owner: ownerOf(field.property, entity) }));
    return out;
  };

  const list = l => {
    const entity = refName(l.entity);
    const form = l.form ? unq(refName(l.form)) : undefined;
    const out = { id: unq(l.name), entity };
    if (l.abstract) out.abstract = true;
    if (form !== undefined) out.form = form;
    out.removeLink = !!l.removeLink;
    out.sorting = !!l.sorting;
    out.searching = !!l.searching;
    out.filtering = !!l.filtering;
    out.properties = l.columns.map(column => {
      const own = column.form ? unq(refName(column.form)) : form;
      return { property: refName(column.property), ...(own !== undefined ? { form: own } : {}), owner: ownerOf(column.property, entity) };
    });
    return out;
  };

  return { data: { forms: model.forms.map(form), lists: model.lists.map(list) } };
};

return spec;
