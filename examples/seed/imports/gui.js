// Import mapping: the inverse of gui.spec.js. Builds the interface from `data.gui`; what the mapping would have filled in anyway is left out of the text.
/** @type {Import} */
const importer = function (json, { n }) {
  const gui = json.data.gui ?? {};
  const font = gui.settings?.font;
  const colorset = gui.settings?.colorset;
  const same = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  const plainFont = !font || (font.family === 'Arial' && font.size === '14px');
  return n('GuiModel', {
    design: gui.design,
    family: plainFont ? undefined : font.family,
    size: plainFont ? undefined : font.size,
    colors: !colorset || same(colorset, ['#fff', '#eee', '#777', '#555', '#577492', '#333', '#222']) ? [] : colorset
  });
};

return importer;
