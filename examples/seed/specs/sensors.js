// JSON mapping: the part of the product specification that the sensors own, `data.dataWarehouse`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  // what a bucket of a range says: `default`, `from` .. `to`, or one value
  const category = b => {
    if (b.default) return { value: 'DEFAULT', label: b.label };
    if (b.min !== undefined) return { from: b.min, to: b.max, label: b.label };
    return { value: b.value, label: b.label };
  };

  const dimension = d => {
    if (d.$type === 'SpatialDimension') return { id: d.name, type: 'SPATIAL', entities: d.entities.map(refName) };
    const out = { id: d.name, type: 'CATEGORICAL', field: refName(d.field) };
    if (d.range?.ref) out.categories = d.range.ref.buckets.map(category);
    return out;
  };

  const measurement = m => {
    const out = { name: m.name, type: m.dataType };
    if (m.units !== undefined) out.units = m.units;
    if (m.icon !== undefined) out.icon = m.icon;
    if (m.range) out.range = refName(m.range);
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
    ...(s.geom !== undefined ? { geom: s.geom } : {}),
    measureData: s.measureData.map(measurement),
    dimensions: s.dimensions.map(dimension)
  });

  // a product without sensors has no data warehouse in its specification
  if (!model.sensors.length && !model.groups.length) return { data: {} };
  return {
    data: {
      dataWarehouse: {
        sensors: model.sensors.map(sensor),
        sensorGroups: model.groups.map(g => ({ id: g.name, sensors: g.sensors.map(refName) }))
      }
    }
  };
};

return spec;
