// JSON mapping: the part of the product specification that the map viewer owns, `data.mapViewer`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  // interval bounds are numbers, except the infinities, which stay text
  const bound = text => (text === 'Infinity' || text === '-Infinity' ? text : Number(text));

  const mapLayer = entry => {
    const out = { name: refName(entry.layer), baseLayer: !!entry.baseLayer };
    if (entry.style) out.style = refName(entry.style);
    out.selected = !!entry.selected;
    out.order = entry.order;
    return out;
  };

  const map = m => {
    const out = { name: m.name, label: m.label ?? m.name };
    if (m.lat !== undefined) out.center = { lat: m.lat, lng: m.lng, zoom: m.zoom };
    out.sortable = !!m.sortable;
    out.layers = m.layers.map(mapLayer);
    return out;
  };

  const layer = l => {
    const label = l.label ?? l.name;
    switch (l.$type) {
      case 'TileLayer':
        return { name: l.name, type: 'tilelayer', label, url: l.url };
      case 'GeoJsonLayer':
        return {
          name: l.name,
          type: 'geojson',
          label,
          // the entity and the field of it that holds the geometry
          entityName: `${refName(l.entity)}-${l.field ?? 'geometry'}`,
          editable: !!l.editable,
          defaultStyle: refName(l.defaultStyle),
          availableStyles: l.availableStyles.map(refName)
        };
      default:
        return { name: l.name, type: 'wmslayer', label };
    }
  };

  const style = s => {
    switch (s.$type) {
      case 'GeoJSONLayerStyle':
        return {
          name: s.name,
          type: 'GeoJSONLayerStyle',
          fillColor: s.fillColor,
          strokeColor: s.strokeColor,
          fillOpacity: s.fillOpacity,
          strokeOpacity: s.strokeOpacity,
          radius: s.radius ?? 3
        };
      case 'StaticIntervalsStyle':
        return {
          name: s.name,
          type: 'StaticIntervalsStyle',
          property: s.property,
          intervals: s.intervals.map(i => ({ minValue: bound(i.min), maxValue: bound(i.max), style: refName(i.style) })),
          defaultStyle: refName(s.defaultStyle)
        };
      default: {
        const out = { name: s.name, type: 'WMSLayerStyle', id: s.styleId, sld: s.sld };
        if (s.layer) out.layer = refName(s.layer);
        return out;
      }
    }
  };

  return {
    data: {
      mapViewer: {
        maps: model.maps.map(map),
        layers: model.layers.map(layer),
        styles: model.styles.map(style)
      }
    }
  };
};

return spec;
