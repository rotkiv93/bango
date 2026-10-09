// JSON mapping: the part of the product specification that the map viewer owns, `data.mapViewer`.
// Merge it with the specs of the other metamodels to get the whole document.
/** @type {Spec} */
const spec = function (model, { refName: refText }) {
  // a style written in quotes comes with them
  const unq = text => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text);
  const refName = ref => unq(refText(ref));
  // the name of what the model declares as it is in the document (only styles are written in quotes)
  const styleName = s => unq(s.name);
  // interval bounds are numbers, except the infinities, which stay text
  const bound = text => (text === 'Infinity' || text === '-Infinity' ? text : Number(text));

  const mapLayer = entry => {
    const out = { name: refName(entry.layer), baseLayer: !!entry.baseLayer };
    if (entry.style) out.style = refName(entry.style);
    if (entry.opacity !== undefined) out.opacity = entry.opacity;
    out.selected = !!entry.selected;
    if (entry.order !== undefined) out.order = entry.order;
    return out;
  };

  const map = m => {
    const out = { name: m.name, label: m.label ?? m.name };
    if (m.layerManager) out.layerManager = refName(m.layerManager);
    if (m.lat !== undefined) out.center = { lat: m.lat, lng: m.lng, zoom: m.zoom };
    out.sortable = !!m.sortable;
    out.layers = m.layers.map(mapLayer);
    if (m.crs || m.minZoom !== undefined) {
      out.mapOptions = {};
      if (m.crs) {
        const options = {};
        if (m.crs.originX !== undefined) options.origin = [m.crs.originX, m.crs.originY];
        if (m.crs.resolutions.length) options.resolutions = [...m.crs.resolutions];
        out.mapOptions.crs = { srid: m.crs.srid, proj4Config: { params: m.crs.proj4, options } };
      }
      if (m.minZoom !== undefined) {
        out.mapOptions.minZoom = m.minZoom;
        out.mapOptions.maxZoom = m.maxZoom;
      }
    }
    return out;
  };

  const layer = l => {
    switch (l.$type) {
      case 'TileLayer':
        return { type: 'tilelayer', name: l.name, ...(l.label !== undefined ? { label: l.label } : {}), url: l.url };
      case 'GeoJsonLayer': {
        const out = {
          name: l.name,
          label: l.label ?? l.name,
          // the entity and the field of it that holds the geometry
          entityName: `${refName(l.entity)}-${l.field ? refName(l.field) : 'geometry'}`,
          type: 'geojson',
          defaultStyle: refName(l.defaultStyle),
          availableStyles: l.availableStyles.map(refName)
        };
        if (l.form !== undefined) out.form = l.form;
        if (l.editable) out.editable = true;
        return out;
      }
      default: {
        // the platform's templates call it `wms`
        const out = { type: 'wms', name: l.name };
        if (l.label !== undefined) out.label = l.label;
        if (l.list !== undefined) out.list = l.list;
        if (l.url !== undefined) out.url = l.url;
        if (l.wmsLayers.length) out.layers = [...l.wmsLayers];
        if (l.availableStyles.length) out.availableStyles = l.availableStyles.map(refName);
        if (l.defaultStyle) out.defaultStyle = refName(l.defaultStyle);
        return out;
      }
    }
  };

  const style = s => {
    switch (s.$type) {
      case 'GeoJSONLayerStyle': {
        const out = { name: styleName(s), type: 'GeoJSONLayerStyle' };
        for (const key of ['fillColor', 'strokeColor', 'fillOpacity', 'strokeOpacity']) if (s[key] !== undefined) out[key] = s[key];
        if (s.radius !== undefined) out.radius = s.radius;
        if (s.weight !== undefined) out.weight = s.weight;
        return out;
      }
      case 'StaticIntervalsStyle': {
        const out = {
          name: styleName(s),
          type: 'StaticIntervalsStyle',
          property: s.property,
          intervals: s.intervals.map(i => ({ minValue: bound(i.min), maxValue: bound(i.max), style: refName(i.style) }))
        };
        if (s.defaultStyle) out.defaultStyle = refName(s.defaultStyle);
        return out;
      }
      case 'CategorizedStyle':
        return {
          name: styleName(s),
          type: 'CategorizedStyle',
          property: s.property,
          values: Object.fromEntries(s.values.map(v => [v.key, refName(v.style)]))
        };
      case 'WMSLayerStyle': {
        const out = { name: styleName(s), type: 'WMSLayerStyle', geometryType: s.geometryType };
        for (const key of ['fillColor', 'strokeColor', 'fillOpacity', 'strokeOpacity']) if (s[key] !== undefined) out[key] = s[key];
        if (s.legendLabel !== undefined) out.legendLabel = s.legendLabel;
        return out;
      }
      default: {
        const out = { name: styleName(s), type: 'WMSLayerSLDStyle' };
        if (s.cached) out.cached = true;
        if (s.sld !== undefined) out.sld = s.sld;
        if (s.sldPath !== undefined) out.sldPath = s.sldPath;
        if (s.geometries.length) out.availableGeometries = s.geometries.map(g => ({ type: g.type, property: g.property }));
        return out;
      }
    }
  };

  const mapViewer = {
    maps: model.maps.map(map),
    layers: model.layers.map(layer),
    styles: model.styles.map(style)
  };
  // the managers of the layers of a map: `[{ <name>: { groups, individualLayers } }]`
  if (model.managers.length) {
    mapViewer.managers = model.managers.map(m => ({ [m.name]: { groups: {}, individualLayers: m.layers.map(refName) } }));
  }

  // a product without map configuration has no map viewer in its specification (the templates ask `data.mapViewer == null`)
  if (!model.declared && !mapViewer.maps.length && !mapViewer.layers.length && !mapViewer.styles.length && !model.managers.length) return { data: {} };
  return { data: { mapViewer } };
};

return spec;
