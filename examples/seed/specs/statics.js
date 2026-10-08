// JSON mapping: the part of the product specification that the static pages own, `data.statics`: `[{ id, html }]`.
/** @type {Spec} */
const spec = function (model) {
  return { data: { statics: model.pages.map(page => ({ id: page.name, html: page.html })) } };
};

return spec;
