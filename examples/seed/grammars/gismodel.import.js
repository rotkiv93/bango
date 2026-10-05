// Import mapping: the inverse of gismodel.spec.js. Builds the GIS model from `data.mapViewer`.
/** @type {Import} */
const importer = function (json, { n }) {
  const mv = json.data.mapViewer;
  // a label that is only the name is not written
  const label = item => (item.label !== item.name ? item.label : undefined);

  const mapLayer = l => n('MapInLayerAndStyle', { layer: l.name, style: l.style, baseLayer: l.baseLayer, selected: l.selected, order: l.order });

  const map = m =>
    n('MapDef', { name: m.name, label: label(m), lat: m.center?.lat, lng: m.center?.lng, zoom: m.center?.zoom, sortable: m.sortable, layers: m.layers.map(mapLayer) });

  const layer = l => {
    switch (l.type) {
      case 'tilelayer':
        return n('TileLayer', { name: l.name, label: label(l), url: l.url });
      case 'geojson': {
        // `entity-field`: the field is written only when it is not `geometry`
        const at = l.entityName.lastIndexOf('-');
        const field = l.entityName.slice(at + 1);
        return n('GeoJsonLayer', {
          name: l.name,
          label: label(l),
          entity: l.entityName.slice(0, at),
          field: field !== 'geometry' ? field : undefined,
          editable: l.editable,
          defaultStyle: l.defaultStyle,
          availableStyles: l.availableStyles
        });
      }
      default:
        return n('WMSLayer', { name: l.name, label: label(l) });
    }
  };

  const style = s => {
    switch (s.type) {
      case 'GeoJSONLayerStyle':
        return n('GeoJSONLayerStyle', {
          name: s.name,
          fillColor: s.fillColor,
          strokeColor: s.strokeColor,
          fillOpacity: s.fillOpacity,
          strokeOpacity: s.strokeOpacity,
          // 3 is what the mapping uses when there is none
          radius: s.radius !== 3 ? s.radius : undefined
        });
      case 'StaticIntervalsStyle':
        return n('StaticIntervalsStyle', {
          name: s.name,
          property: s.property,
          intervals: s.intervals.map(i => n('StyleInterval', { min: String(i.minValue), max: String(i.maxValue), style: i.style })),
          defaultStyle: s.defaultStyle
        });
      default:
        return n('WMSLayerStyle', { name: s.name, styleId: s.id, sld: s.sld, layer: s.layer });
    }
  };

  return n('Gis', { maps: mv.maps.map(map), layers: mv.layers.map(layer), styles: mv.styles.map(style) });
};

return importer;
