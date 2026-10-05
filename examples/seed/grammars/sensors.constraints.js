// Rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
// accept(severity, message, { node, property, index }) reports a problem on the node.
const property = (entity, name) => entity?.fields.filter(f => f.$type === 'PropertyField').find(f => f.name === name);
const relatedTo = (entity, other) =>
  !!entity && !!other && entity.fields.some(f => f.$type === 'RelationshipField' && f.target.ref === other);

/** @type {Constraints} */
const constraints = {
  SensorModel(model, accept) {
    for (const { item } of duplicates([...model.sensors, ...model.groups], n => n.name)) {
      accept('error', `duplicate sensor or group '${item.name}'`, { node: item, property: 'name' });
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
    if (entity && geometry && geometry.class !== sensor.geom) {
      accept('warning', `sensor '${sensor.name}' says ${sensor.geom}, but '${entity.name}.geometry' is ${geometry.class}`, { node: sensor, property: 'geom' });
    }
    if (entity && layer?.entity?.ref && layer.entity.ref !== entity) {
      accept('error', `layer '${layer.name}' shows entity '${layer.entity.ref.name}', but sensor '${sensor.name}' stores in '${entity.name}'`, { node: sensor, property: 'defaultLayer' });
    }
    if (map && layer && !map.layers.some(e => e.layer?.ref === layer)) {
      accept('warning', `map '${map.name}' does not show layer '${layer.name}'`, { node: sensor, property: 'defaultMap' });
    }

    for (const { item, index } of duplicates(sensor.measureData, m => m.name)) {
      accept('error', `measurement '${item.name}' is declared twice`, { node: sensor, property: 'measureData', index });
    }
    for (const { item, index } of duplicates(sensor.dimensions, d => d.name)) {
      accept('error', `dimension '${item.name}' is declared twice`, { node: sensor, property: 'dimensions', index });
    }

    sensor.dimensions.forEach(d => {
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

return constraints;
