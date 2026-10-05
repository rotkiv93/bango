// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
// accept(severity, message, { node, property, index }) reports a problem on the node.
const property = (entity, name) => entity?.fields.find(f => f.$type === 'PropertyField' && f.name === name);
const relatedTo = (entity, other) =>
  !!entity && !!other && entity.fields.some(f => f.$type === 'RelationshipField' && f.target.ref === other);

return {
  SensorModel(model, accept) {
    if (!model.product) accept('warning', 'a sensor specification should start with a product', { node: model, property: 'name' });
    const seen = new Set();
    for (const node of [...model.sensors, ...model.groups]) {
      if (seen.has(node.name)) accept('error', `duplicate sensor or group '${node.name}'`, { node, property: 'name' });
      seen.add(node.name);
    }
  },

  SensorDef(sensor, accept) {
    const entity = sensor.entity?.ref;
    const factTable = sensor.factTable?.ref;
    const layer = sensor.defaultLayer?.ref;
    const map = sensor.defaultMap?.ref;

    // the fact table holds the observations, so it has to point at the sensor entity
    if (entity && factTable && !relatedTo(factTable, entity)) {
      accept('error', `fact table '${factTable.name}' has no relationship to '${entity.name}'`, { node: sensor, property: 'factTable' });
    }

    // every measurement is a property of the fact table, of the same type
    sensor.measureData.forEach((m, index) => {
      if (!factTable) return;
      const p = property(factTable, m.name);
      if (!p) {
        accept('error', `measurement '${m.name}' is not a property of fact table '${factTable.name}'`, { node: sensor, property: 'measureData', index });
      } else if (p.class !== m.dataType) {
        accept('error', `measurement '${m.name}' is ${m.dataType}, but '${factTable.name}.${m.name}' is ${p.class}`, { node: sensor, property: 'measureData', index });
      }
    });

    // the sensor draws what it stores: the geometry of the entity, on a layer that shows that entity
    const geometry = property(entity, 'geometry');
    if (geometry && geometry.class !== sensor.geom) {
      accept('warning', `sensor '${sensor.name}' says ${sensor.geom}, but '${entity.name}.geometry' is ${geometry.class}`, { node: sensor, property: 'geom' });
    }
    if (entity && layer?.entity?.ref && layer.entity.ref !== entity) {
      accept('error', `layer '${layer.name}' shows entity '${layer.entity.ref.name}', but sensor '${sensor.name}' stores in '${entity.name}'`, { node: sensor, property: 'defaultLayer' });
    }
    if (map && layer && !map.layers.some(e => e.layer?.ref === layer)) {
      accept('warning', `map '${map.name}' does not show layer '${layer.name}'`, { node: sensor, property: 'defaultMap' });
    }

    const names = new Set();
    sensor.measureData.forEach((m, index) => {
      if (names.has(m.name)) accept('error', `measurement '${m.name}' is declared twice`, { node: sensor, property: 'measureData', index });
      names.add(m.name);
    });

    const dimensions = new Set();
    sensor.dimensions.forEach((d, index) => {
      if (dimensions.has(d.name)) accept('error', `dimension '${d.name}' is declared twice`, { node: sensor, property: 'dimensions', index });
      dimensions.add(d.name);

      if (d.$type === 'CategoricalDimension' && factTable && !property(factTable, d.field)) {
        accept('error', `categorical field '${d.field}' is not a property of fact table '${factTable.name}'`, { node: d, property: 'field' });
      }
      // a spatial dimension is a chain of entities that locate the sensor entity
      if (d.$type === 'SpatialDimension' && entity) {
        d.entities.forEach((ref, i) => {
          const e = ref.ref;
          if (e && !relatedTo(e, entity) && !relatedTo(entity, e) && !d.entities.some(o => o.ref !== e && (relatedTo(o.ref, e) || relatedTo(e, o.ref)))) {
            accept('warning', `'${e.name}' is not related to '${entity.name}' or to the rest of the dimension`, { node: d, property: 'entities', index: i });
          }
        });
      }
    });
  }
};
