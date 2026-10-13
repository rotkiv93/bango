// Import mapping: the inverse of gismodel.spec.js. Builds the GIS model from `data.mapViewer`.
/** @type {Import} */
const importer = function (json, { n }) {
  // a viewer that is not there (the product has no map) has nothing to build
  const mv = json.data.mapViewer ?? {};
  const layers = Array.isArray(mv.layers) ? mv.layers : [];
  // the name of a style that is not a plain word is written in quotes (its uses are written the same way)
  const q = text => (text === undefined ? undefined : /^[_a-zA-Z][\w-]*$/.test(text) ? text : JSON.stringify(text));
  // a label that is only the name is not written
  const sameLabel = item => (item.label !== item.name ? item.label : undefined);

  const mapLayer = l => n('MapInLayerAndStyle', { layer: l.name, style: q(l.style), opacity: l.opacity, baseLayer: l.baseLayer, selected: l.selected, order: l.order });

  const crs = o => {
    const c = o?.crs;
    if (!c) return undefined;
    const options = c.proj4Config?.options ?? {};
    return n('MapCrs', {
      srid: c.srid,
      proj4: c.proj4Config?.params,
      originX: options.origin?.[0],
      originY: options.origin?.[1],
      resolutions: options.resolutions ?? []
    });
  };

  const map = m =>
    n('MapDef', {
      name: m.name,
      label: sameLabel(m),
      lat: m.center?.lat,
      lng: m.center?.lng,
      zoom: m.center?.zoom,
      minZoom: m.mapOptions?.minZoom,
      maxZoom: m.mapOptions?.maxZoom,
      crs: crs(m.mapOptions),
      layerManager: m.layerManager,
      sortable: m.sortable === true || m.sortable === 'true',
      layers: m.layers.map(mapLayer)
    });

  const layer = l => {
    switch (l.type) {
      case 'tilelayer':
        return n('TileLayer', { name: l.name, label: l.label, url: l.url });
      case 'geojson': {
        // `entity-field`: the field is written only when it is not `geometry` (an entity alone is the same as its `geometry`)
        const at = l.entityName.lastIndexOf('-');
        const field = at < 0 ? 'geometry' : l.entityName.slice(at + 1);
        return n('GeoJsonLayer', {
          name: l.name,
          label: sameLabel(l),
          entity: at < 0 ? l.entityName : l.entityName.slice(0, at),
          field: field !== 'geometry' ? field : undefined,
          form: l.form,
          editable: l.editable,
          defaultStyle: q(l.defaultStyle),
          availableStyles: (l.availableStyles ?? []).map(q)
        });
      }
      default:
        return n('WMSLayer', {
          name: l.name,
          label: l.label,
          list: l.list,
          url: l.url,
          wmsLayers: l.layers ?? [],
          defaultStyle: q(l.defaultStyle),
          availableStyles: (l.availableStyles ?? []).map(q)
        });
    }
  };

  const style = s => {
    switch (s.type) {
      case 'GeoJSONLayerStyle':
        return n('GeoJSONLayerStyle', {
          name: q(s.name),
          fillColor: s.fillColor ?? undefined,
          strokeColor: s.strokeColor ?? undefined,
          fillOpacity: s.fillOpacity == null ? undefined : Number(s.fillOpacity),
          strokeOpacity: s.strokeOpacity == null ? undefined : Number(s.strokeOpacity),
          radius: s.radius,
          weight: s.weight
        });
      case 'StaticIntervalsStyle':
        return n('StaticIntervalsStyle', {
          name: q(s.name),
          property: s.property,
          intervals: s.intervals.map(i => n('StyleInterval', { min: String(i.minValue), max: String(i.maxValue), style: q(i.style) })),
          defaultStyle: q(s.defaultStyle)
        });
      case 'CategorizedStyle':
        return n('CategorizedStyle', {
          name: q(s.name),
          property: s.property,
          values: Object.entries(s.values).map(([key, style]) => n('CategoryValue', { key, style: q(style) }))
        });
      case 'WMSLayerStyle':
        return n('WMSLayerStyle', {
          name: q(s.name),
          geometryType: s.geometryType,
          fillColor: s.fillColor ?? undefined,
          strokeColor: s.strokeColor ?? undefined,
          fillOpacity: s.fillOpacity ?? undefined,
          strokeOpacity: s.strokeOpacity ?? undefined,
          legendLabel: s.legendLabel
        });
      default:
        return n('WMSLayerSLDStyle', {
          name: q(s.name),
          cached: s.cached,
          sld: s.sld,
          sldPath: s.sldPath,
          geometries: (s.availableGeometries ?? []).map(g => n('StyleGeometry', { type: g.type, property: g.property }))
        });
    }
  };

  const managers = (mv.managers ?? []).flatMap(entry =>
    Object.entries(entry).map(([name, manager]) => n('LayerManager', { name, layers: manager.individualLayers ?? [] }))
  );

  // the viewer is there, with nothing in it
  const declared = json.data.mapViewer !== undefined && !(mv.maps ?? []).length && !layers.length && !(mv.styles ?? []).length && !(mv.managers ?? []).length;

  return n('Gis', { declared, maps: (mv.maps ?? []).map(map), layers: layers.map(layer), styles: (mv.styles ?? []).map(style), managers });
};

return importer;
