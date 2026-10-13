// JSON mapping: the part of the product specification that the static pages own, `data.statics`: `[{ id, html }]`.
/** @type {Spec} */
const spec = function (model) {
  // no pages, no `statics` in the specification
  if (!model.pages.length) return { data: {} };
  return { data: { statics: model.pages.map(page => ({ id: page.name, html: page.html })) } };
};

return spec;
