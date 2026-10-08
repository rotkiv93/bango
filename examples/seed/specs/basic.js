// JSON mapping: the root of the product specification. It owns `features` and `data.basicData`, and it lays out
// the whole document: the empty slots below are filled in by the other metamodels (data model, GIS model,
// sensors, forms, lists, menus, static pages), and fix the order of the keys in the merged document.
/** @type {Spec} */
const spec = {
  // merged first: its key order becomes the order of the merged document
  root: true,
  map(model) {
    const basicData = {
      name: model.name,
      languages: model.languages.length ? [...model.languages] : ['en', 'es', 'gl'],
      // what the platform's templates read: `packageInfo.artifact`
      packageInfo: {
        artifact: model.artifactId ?? model.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        group: model.groupId ?? 'es.udc.lbd.gisspl'
      },
      SRID: String(model.srid ?? 4326)
    };
    if (model.version !== undefined) basicData.version = model.version;
    if (model.dbHost !== undefined) {
      basicData.database = { host: model.dbHost, database: model.dbName, username: model.dbUser, password: model.dbPassword };
      if (model.dbPort !== undefined) basicData.database.port = model.dbPort;
    }
    if (model.extras.length) basicData.extra = Object.fromEntries(model.extras.map(e => [e.key, e.value]));

    return {
      features: [...model.features],
      data: {
        basicData,
        dataModel: {},        // datamodel
        dataWarehouse: {},    // sensors
        forms: [],            // forms
        lists: [],            // lists
        menus: [],            // menus
        mapViewer: {},        // gismodel
        statics: []           // statics
      }
    };
  }
};

return spec;
