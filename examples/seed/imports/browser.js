// Import mapping: the inverse of browser.spec.js. Builds the forms and the lists from `data.forms` and `data.lists`.
/** @type {Import} */
const importer = function (json, { n }) {
  // a name that is not a plain word is written in quotes (its uses are written the same way)
  const q = text => (text === undefined ? undefined : /^[_a-zA-Z][\w-]*$/.test(text) ? text : JSON.stringify(text));

  const field = f => n('FormField', { property: f.property, viewed: f.viewing, edited: f.editing });

  const form = f =>
    n('FormDef', {
      name: q(f.id),
      entity: f.entity,
      abstract: f.abstract,
      allowCreate: f.creatable,
      allowEdit: f.editable,
      allowRemove: f.removable,
      confirmRemove: f.confirmation,
      fields: (f.properties ?? []).map(field)
    });

  // the form of a column is written when it is not the form of the list
  const column = (c, l) => n('ListColumn', { property: c.property, form: c.form !== l.form ? q(c.form) : undefined });

  const list = l =>
    n('ListDef', {
      name: q(l.id),
      entity: l.entity,
      abstract: l.abstract,
      form: q(l.form),
      removeLink: l.removeLink,
      sorting: l.sorting,
      searching: l.searching,
      filtering: l.filtering,
      columns: (l.properties ?? []).map(c => column(c, l))
    });

  return n('BrowserModel', { forms: (json.data.forms ?? []).map(form), lists: (json.data.lists ?? []).map(list) });
};

return importer;
