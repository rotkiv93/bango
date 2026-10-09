// Import mapping: the inverse of sensors.spec.js. Builds the sensors from `data.dataWarehouse`.
/** @type {Import} */
const importer = function (json, { n }) {
  // a product without sensors has an empty (or no) data warehouse
  const dw = json.data.dataWarehouse ?? {};
  const sensors = dw.sensors ?? [];

  // The JSON has no ranges, only the categories of each categorical dimension and the name of the range of each measurement. Dimensions
  // with the same categories share a range, named after the first of them; a range only a measurement names has no labels.
  const ranges = [];
  const byCategories = new Map();
  const taken = new Set(sensors.flatMap(s => s.measureData.map(m => m.range)).filter(Boolean));
  const unique = base => {
    let name = base;
    for (let i = 2; ranges.some(r => r.name === name); i++) name = `${base}${i}`;
    return name;
  };
  const rangeFor = d => {
    const key = JSON.stringify(d.categories);
    if (!byCategories.has(key)) {
      const name = unique(`${d.id}Range`);
      byCategories.set(key, name);
      ranges.push({ name, categories: d.categories });
    }
    return byCategories.get(key);
  };

  const bucket = c => {
    if (c.value === 'DEFAULT') return n('RangeBucket', { default: true, label: c.label });
    if ('from' in c) return n('RangeBucket', { min: c.from, max: c.to, label: c.label });
    return n('RangeBucket', { value: c.value, label: c.label });
  };

  const dimension = d =>
    d.type === 'SPATIAL'
      ? n('SpatialDimension', { name: d.id, entities: d.entities })
      : n('CategoricalDimension', { name: d.id, field: d.field, range: d.categories ? rangeFor(d) : undefined });

  const sensor = s =>
    n('SensorDef', {
      moving: s.isMoving,
      name: s.id,
      time: s.time,
      geom: s.geom,
      entity: s.entity,
      factTable: s.factTableEntity,
      defaultMap: s.defaultMap,
      defaultLayer: s.defaultLayer,
      measureData: s.measureData.map(m => n('Measurement', { name: m.name, dataType: m.type, units: m.units, icon: m.icon, range: m.range })),
      dimensions: s.dimensions.map(dimension)
    });

  const built = sensors.map(sensor);
  for (const name of taken) if (!ranges.some(r => r.name === name)) ranges.push({ name, categories: [] });

  return n('SensorModel', {
    ranges: ranges.map(r => n('SensorRange', { name: r.name, buckets: r.categories.map(bucket) })),
    sensors: built,
    groups: (dw.sensorGroups ?? []).map(g => n('SensorGroup', { name: g.id, sensors: g.sensors }))
  });
};

return importer;
