// JSON mapping: the root of the product specification. It owns `features` and `data.basicData`, and it lays out
// the whole document: the empty slots below are filled in by the other metamodels (data model, GIS model,
// sensors, forms, lists), and fix the order of the keys in the merged document. `menus` and `statics` are not
// described by any metamodel yet, so they stay empty.
return {
  // merged first: its key order becomes the order of the merged document
  root: true,
  map(model) {
    const basicData = {
      name: model.name,
      // the defaults of the sensor DSL
      index: { component: model.indexComponent ?? 'STATIC', view: model.indexView ?? 'welcome' },
      languages: model.languages.length ? [...model.languages] : ['en', 'es', 'gl'],
      packageInfo: {
        artifactId: model.artifactId ?? model.name,
        groupId: model.groupId ?? `es.udc.lbd.${model.name.toLowerCase()}`
      },
      SRID: String(model.srid ?? 4326)
    };
    if (model.dbHost !== undefined) {
      basicData.database = { host: model.dbHost, database: model.dbName, username: model.dbUser, password: model.dbPassword };
    }

    return {
      features: [...model.features],
      data: {
        basicData,
        dataModel: {},        // datamodel
        dataWarehouse: {},    // sensors
        forms: [],            // forms
        lists: [],            // lists
        menus: [],
        mapViewer: {},        // gismodel
        statics: []
      }
    };
  }
};
