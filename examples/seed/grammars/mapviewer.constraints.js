// Extra rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
// accept(severity, message, { node, property, index }) reports a problem on the node.
const SPATIAL = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
const bound = text => (text === 'Infinity' ? Infinity : text === '-Infinity' ? -Infinity : Number(text));

return {
  GeoJsonLayer(layer, accept) {
    const available = layer.availableStyles.map(ref => ref.$refText);
    if (layer.defaultStyle && !available.includes(layer.defaultStyle.$refText)) {
      accept('error', `defaultStyle '${layer.defaultStyle.$refText}' must be one of availableStyles`, { node: layer, property: 'defaultStyle' });
    }

    // the field the layer draws must exist in the entity and hold a geometry
    const entity = layer.entity?.ref;
    if (!entity) return;
    const fieldName = layer.field ?? 'geometry';
    const field = entity.fields.find(f => f.$type === 'PropertyField' && f.name === fieldName);
    if (!field) {
      accept('error', `entity '${entity.name}' has no property '${fieldName}' to draw`, { node: layer, property: layer.field ? 'field' : 'entity' });
    } else if (!SPATIAL.includes(field.class)) {
      accept('error', `'${entity.name}.${fieldName}' is a ${field.class}, not a geometry`, { node: layer, property: layer.field ? 'field' : 'entity' });
    }
  },

  MapDef(map, accept) {
    const orders = new Set();
    for (const entry of map.layers) {
      if (orders.has(entry.order)) {
        accept('warning', `order ${entry.order} is used twice in map '${map.name}'`, { node: entry, property: 'order' });
      }
      orders.add(entry.order);
    }
    if (map.layers.filter(e => e.baseLayer).length > 1) {
      accept('warning', `map '${map.name}' has more than one base layer`, { node: map, property: 'name' });
    }
  },

  MapInLayerAndStyle(entry, accept) {
    const layer = entry.layer?.ref;
    if (!layer) return;
    const drawsData = layer.$type !== 'TileLayer';
    if (drawsData && !entry.style) {
      accept('error', `layer '${layer.name}' draws data: choose a style for it`, { node: entry, property: 'layer' });
    }
    // the style must be one the layer offers
    if (entry.style && layer.$type === 'GeoJsonLayer') {
      const available = layer.availableStyles.map(ref => ref.$refText);
      if (!available.includes(entry.style.$refText)) {
        accept('error', `style '${entry.style.$refText}' is not one of the available styles of layer '${layer.name}'`, { node: entry, property: 'style' });
      }
    }
  },

  StyleInterval(interval, accept) {
    if (bound(interval.min) > bound(interval.max)) {
      accept('error', `interval goes backwards: ${interval.min} to ${interval.max}`, { node: interval, property: 'max' });
    }
  }
};
