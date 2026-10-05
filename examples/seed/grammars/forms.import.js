// Import mapping: the inverse of forms.spec.js. Builds the forms from `data.forms`.
/** @type {Import} */
const importer = function (json, { n }) {
  // a label that is only the name is not written
  const label = (item, name) => (item.label !== name ? item.label : undefined);

  const field = f => n('FormField', { property: f.name, label: label(f, f.name), readOnly: f.readOnly });

  const form = f => n('FormDef', { name: f.name, label: label(f, f.name), entity: f.entity, fields: f.fields?.map(field) });

  return n('FormModel', { forms: json.data.forms.map(form) });
};

return importer;
