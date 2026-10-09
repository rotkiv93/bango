// JSON mapping: the part of the product specification that the interface owns, `data.gui` (`basic` adds the header, which shows the product's name).
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model) {
  return {
    data: {
      gui: {
        design: model.design ?? '4',
        settings: {
          font: { family: model.family ?? 'Arial', size: model.size ?? '14px' },
          colorset: model.colors.length ? [...model.colors] : ['#fff', '#eee', '#777', '#555', '#577492', '#333', '#222']
        }
      }
    }
  };
};

return spec;
