// Rules the grammar cannot express: a page has a name of its own, and some content.
/** @type {Constraints} */
const constraints = {
  StaticsModel(model, accept) {
    const seen = new Set();
    for (const page of model.pages) {
      if (seen.has(page.name)) accept('error', `duplicate page '${page.name}'`, { node: page, property: 'name' });
      seen.add(page.name);
    }
  },

  StaticPage(page, accept) {
    if (!page.html.trim().slice(1, -1).trim()) accept('warning', `page '${page.name}' has no content`, { node: page, property: 'html' });
  }
};

return constraints;
