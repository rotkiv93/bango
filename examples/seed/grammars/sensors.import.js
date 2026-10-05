// Import mapping: the inverse of sensors.spec.js. Builds the sensors from `data.dataWarehouse`.
/** @type {Import} */
const importer = function (json, { n }) {
  const dw = json.data.dataWarehouse;

  const dimension = d =>
    d.type === 'SPATIAL' ? n('SpatialDimension', { name: d.id, entities: d.entities }) : n('CategoricalDimension', { name: d.id, field: d.field });

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
      measureData: s.measureData.map(m => n('Measurement', { name: m.name, dataType: m.type, units: m.units })),
      dimensions: s.dimensions.map(dimension)
    });

  return n('SensorModel', {
    sensors: dw.sensors.map(sensor),
    groups: dw.sensorGroups.map(g => n('SensorGroup', { name: g.id, sensors: g.sensors }))
  });
};

return importer;
