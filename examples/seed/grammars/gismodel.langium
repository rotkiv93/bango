grammar GisModel
import './common'
import './datamodel'

// GIS model: maps, layers and styles. A GeoJSON layer must show a data-model entity.
entry Gis: 'gismodel' (maps+=MapDef | layers+=Layer | styles+=Style)*;

// A map shows layers in an order; `center lat lng zoom N` is where it opens
MapDef: 'map' name=ID ('label' label=STRING)? ('center' lat=SignedNumber lng=SignedNumber 'zoom' zoom=INT)?
  ('zoomRange' minZoom=INT maxZoom=INT)? (crs=MapCrs)? (sortable?='sortable')?
  '{' (layers+=MapInLayerAndStyle)+ '}';

// The projection of a map that is not the web one: `crs "EPSG:25829" proj4 "+proj=utm ..." origin -5120900 9998100 resolutions 4891.9, 2445.9`
MapCrs: 'crs' srid=STRING 'proj4' proj4=STRING ('origin' originX=SignedNumber originY=SignedNumber)? ('resolutions' resolutions+=Double (',' resolutions+=Double)*)?;

// A layer on a map. Layers that draw data (GeoJSON, WMS) need a style, the base tile layer does not.
MapInLayerAndStyle: 'use' layer=[Layer:ID] ('style' style=[Style:ID])? ('opacity' opacity=Double)?
  (baseLayer?='baseLayer')? (selected?='selected')? 'order' order=INT;

Layer: TileLayer | GeoJsonLayer | WMSLayer;

TileLayer: 'tilelayer' name=ID ('label' label=STRING)? 'url' url=STRING;

// Draws one spatial field (`geometry` unless `field` says otherwise) of a data-model entity: gismodel.scope.js limits `field` to the entity's properties
GeoJsonLayer: 'geojsonlayer' name=ID ('label' label=STRING)? 'entity' entity=[Entity:ID] ('field' field=[PropertyField:ID])? (editable?='editable')?
  'defaultStyle' defaultStyle=[Style:ID]
  'availableStyles' availableStyles+=[Style:ID] (',' availableStyles+=[Style:ID])*;

// A layer served by a WMS: of this product's GeoServer when it has no `url`; `layers` are the names it asks the server for
WMSLayer: 'wmslayer' name=ID ('label' label=STRING)? ('url' url=STRING)? ('layers' wmsLayers+=STRING (',' wmsLayers+=STRING)*)?;

Style: GeoJSONLayerStyle | StaticIntervalsStyle | WMSLayerStyle;

GeoJSONLayerStyle: 'geojsonstyle' name=ID
  'fillColor' fillColor=STRING 'strokeColor' strokeColor=STRING
  'fillOpacity' fillOpacity=Double 'strokeOpacity' strokeOpacity=Double
  ('radius' radius=Double)?;

// Picks a style by the value of a property: `from -Infinity to 20 style green`
StaticIntervalsStyle: 'intervalstyle' name=ID 'property' property=STRING
  (intervals+=StyleInterval)+
  'defaultStyle' defaultStyle=[Style:ID];

StyleInterval: 'from' min=IntervalBound 'to' max=IntervalBound 'style' style=[Style:ID];

IntervalBound returns string: '-'? (FLOAT | INT | 'Infinity');

WMSLayerStyle: 'wmsstyle' name=ID 'id' styleId=STRING 'sld' sld=STRING
  ('layer' layer=[WMSLayer:ID])?;
