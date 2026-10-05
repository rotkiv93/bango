// JSON mapping: the part of the product specification that the sensors own, `data.dataWarehouse`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  const dimension = d => {
    if (d.$type === 'SpatialDimension') return { id: d.name, type: 'SPATIAL', entities: d.entities.map(refName) };
    return { id: d.name, type: 'CATEGORICAL', field: refName(d.field) };
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
