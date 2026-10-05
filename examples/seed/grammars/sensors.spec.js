// JSON mapping: the root of the product specification. It owns `features`, `data.basicData`, `data.dataWarehouse`
// and the parts of `data` that are still empty (forms, lists, menus, statics). The data model owns `data.dataModel`
// and the map viewer `data.mapViewer`: merging the three specs gives the whole document, key for key.
return function (model, { refName }) {
  const basicData = product => {
    const out = {
      name: product.name,
      // the defaults of the sensor DSL
      index: { component: product.indexComponent ?? 'STATIC', view: product.indexView ?? 'welcome' },
      languages: product.languages.length ? [...product.languages] : ['en', 'es', 'gl'],
      packageInfo: {
        artifactId: product.artifactId ?? product.name,
        groupId: product.groupId ?? `es.udc.lbd.${product.name.toLowerCase()}`
      },
      SRID: String(product.srid ?? 4326)
    };
    if (product.dbHost !== undefined) {
      out.database = { host: product.dbHost, database: product.dbName, username: product.dbUser, password: product.dbPassword };
    }
    return out;
  };

  const dimension = d => {
    if (d.$type === 'SpatialDimension') return { id: d.name, type: 'SPATIAL', entities: d.entities.map(refName) };
    return { id: d.name, type: 'CATEGORICAL', field: d.field };
  };

  const measurement = m => {
    const out = { name: m.name, type: m.dataType };
    if (m.units !== undefined) out.units = m.units;
    return out;
  };

  const sensor = s => ({
    id: s.name,
    entity: refName(s.entity),
    defaultMap: refName(s.defaultMap),
    defaultLayer: refName(s.defaultLayer),
    time: s.time,
    isMoving: !!s.moving,
    factTableEntity: refName(s.factTable),
    geom: s.geom,
    measureData: s.measureData.map(measurement),
    dimensions: s.dimensions.map(dimension)
  });

  const out = {};
  const product = model.product;
  if (product) out.features = [...product.features];
  const data = {};
  if (product) data.basicData = basicData(product);
  // empty slots that the data model and the map viewer fill: they fix the order of the keys in the merged document
  data.dataModel = {};
  data.dataWarehouse = {
    sensors: model.sensors.map(sensor),
    sensorGroups: model.groups.map(g => ({ id: g.name, sensors: g.sensors.map(refName) }))
  };
  data.forms = [];
  data.lists = [];
  data.menus = [];
  data.mapViewer = {};
  data.statics = [];
  out.data = data;
  return out;
};
