// Import mapping: the inverse of statics.spec.js. Builds the static pages from `data.statics`.
/** @type {Import} */
const importer = function (json, { n }) {
  return n('StaticsModel', { pages: (json.data?.statics ?? []).map(page => n('StaticPage', { name: page.id, html: page.html })) });
};

return importer;
