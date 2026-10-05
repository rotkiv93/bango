// JSON mapping: the part of the product specification that the forms own, `data.forms`.
// Merge it with the specs of the other metamodels to get the whole document.
return function (model, { refName }) {
  const field = f => ({ name: f.property, label: f.label ?? f.property, readOnly: !!f.readOnly });

  const form = f => {
    const out = { name: f.name, label: f.label ?? f.name, entity: refName(f.entity) };
    // without a list of fields the form shows every field of the entity
    if (f.fields.length) out.fields = f.fields.map(field);
    return out;
  };

  return { data: { forms: model.forms.map(form) } };
};
