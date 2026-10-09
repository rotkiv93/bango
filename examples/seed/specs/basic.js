// JSON mapping: the root of the product specification. It owns `features` and `data.basicData`, and it lays out
// the whole document: the empty slots below are filled in by the other metamodels (data model, GIS model,
// sensors, forms, lists, menus, static pages), and fix the order of the keys in the merged document.
/** @type {Spec} */
const spec = {
  // merged first: its key order becomes the order of the merged document
  root: true,
  map(model) {
    // a name written in quotes comes with them
    const name = /^["']/.test(model.name) ? model.name.slice(1, -1).replace(/\\(.)/g, '$1') : model.name;
    const basicData = {
      name,
      // where the platform's first screen is: it is always the welcome page
      index: { component: 'STATIC', view: 'welcome' },
      languages: model.languages.length ? [...model.languages] : ['en', 'es', 'gl'],
      // what the platform's templates read: `packageInfo.artifact`
      packageInfo: {
        artifact: model.artifactId ?? name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        group: model.groupId ?? 'es.udc.lbd.gisspl'
      },
      SRID: String(model.srid ?? 4326)
    };
    if (model.version !== undefined) basicData.version = model.version;
    const database = {};
    if (model.dbHost !== undefined) database.host = model.dbHost;
    if (model.dbPort !== undefined) database.port = model.dbPort;
    if (model.dbName !== undefined) database.database = model.dbName;
    if (model.dbUser !== undefined) database.username = model.dbUser;
    if (model.dbPassword !== undefined) database.password = model.dbPassword;
    basicData.database = database;
    if (model.elasticUris !== undefined || model.elasticUser !== undefined || model.elasticPassword !== undefined) {
      basicData.elastic = {};
      if (model.elasticUris !== undefined) basicData.elastic.uris = model.elasticUris;
      if (model.elasticUser !== undefined) basicData.elastic.username = model.elasticUser;
      if (model.elasticPassword !== undefined) basicData.elastic.password = model.elasticPassword;
    }
    if (model.extras.length) basicData.extra = Object.fromEntries(model.extras.map(e => [e.key, e.value]));

    return {
      features: [...model.features],
      data: {
        basicData,
        dataModel: {},        // datamodel
        gui: { settings: { header: { type: 'Text', text: name } } },   // gui (and the header, which is the name)
        forms: [],            // forms
        lists: [],            // lists
        menus: []             // menus
      }
    };
  }
};

return spec;
