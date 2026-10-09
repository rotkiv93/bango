grammar GisModel
import './common'
import './datamodel'

// GIS model: maps, layers, styles and layer managers. A GeoJSON layer must show a data-model entity.
// A model with nothing in it says there is no map configuration (the product shows a layer of each entity with geometry); `declared` says the configuration is there, empty.
entry Gis: 'gismodel' (declared?='declared')? (maps+=MapDef | layers+=Layer | styles+=Style | managers+=LayerManager)*;

// A map shows layers in an order; `center lat lng zoom N` is where it opens; `layerManager` is the manager that groups its layers
MapDef: 'map' name=ID ('label' label=STRING)? ('center' lat=SignedNumber lng=SignedNumber 'zoom' zoom=INT)?
  ('zoomRange' minZoom=INT maxZoom=INT)? (crs=MapCrs)? ('layerManager' layerManager=[LayerManager:ID])? (sortable?='sortable')?
  '{' (layers+=MapInLayerAndStyle)+ '}';

// The projection of a map that is not the web one: `crs "EPSG:25829" proj4 "+proj=utm ..." origin -5120900 9998100 resolutions 4891.9, 2445.9`
MapCrs: 'crs' srid=STRING 'proj4' proj4=STRING ('origin' originX=SignedNumber originY=SignedNumber)? ('resolutions' resolutions+=Double (',' resolutions+=Double)*)?;

// A layer on a map. Layers that draw data (GeoJSON, WMS) need a style, the base tile layer does not.
MapInLayerAndStyle: 'use' layer=[Layer:ID] ('style' style=[Style:StyleName])? ('opacity' opacity=Double)?
  (baseLayer?='baseLayer')? (selected?='selected')? ('order' order=INT)?;

// What the layer manager of a map shows as layers of their own (the ones it does not put in a group)
LayerManager: 'layermanager' name=ID '{' ('shows' layers+=[Layer:ID] (',' layers+=[Layer:ID])*)? '}';

Layer: TileLayer | GeoJsonLayer | WMSLayer;

TileLayer: 'tilelayer' name=ID ('label' label=STRING)? 'url' url=STRING;

// Draws one spatial field (`geometry` unless `field` says otherwise) of a data-model entity: gismodel.scope.js limits `field` to the entity's properties.
// `form` is the form the layer opens a feature in
GeoJsonLayer: 'geojsonlayer' name=ID ('label' label=STRING)? 'entity' entity=[Entity:ID] ('field' field=[PropertyField:FieldName])? ('opensform' form=STRING)? (editable?='editable')?
  'defaultStyle' defaultStyle=[Style:StyleName]
  'availableStyles' availableStyles+=[Style:StyleName] (',' availableStyles+=[Style:StyleName])*;

// A layer served by a WMS: of this product's GeoServer when it has no `url`; `list` is what the server calls the data (a table), `layers` the names it asks the server for
WMSLayer: 'wmslayer' name=ID ('label' label=STRING)? ('wmslist' list=STRING)? ('url' url=STRING)? ('layers' wmsLayers+=STRING (',' wmsLayers+=STRING)*)?
  ('defaultStyle' defaultStyle=[Style:StyleName])?
  ('availableStyles' availableStyles+=[Style:StyleName] (',' availableStyles+=[Style:StyleName])*)?;

Style: GeoJSONLayerStyle | StaticIntervalsStyle | CategorizedStyle | WMSLayerStyle | WMSLayerSLDStyle;

// The name of a style: a word, or a text in quotes when it has spaces ("Estilo linea 1"); references to it are written the same way
StyleName returns string: ID | STRING;

GeoJSONLayerStyle: 'geojsonstyle' name=StyleName
  ('fillColor' fillColor=STRING)? ('strokeColor' strokeColor=STRING)?
  ('fillOpacity' fillOpacity=Double)? ('strokeOpacity' strokeOpacity=Double)?
  ('radius' radius=Double)? ('strokeWeight' weight=Double)?;

// Picks a style by the value of a property: `from -Infinity to 20 style green`
StaticIntervalsStyle: 'intervalstyle' name=StyleName 'property' property=STRING
  (intervals+=StyleInterval)+
  ('defaultStyle' defaultStyle=[Style:StyleName])?;

StyleInterval: 'from' min=IntervalBound 'to' max=IntervalBound 'style' style=[Style:StyleName];

IntervalBound returns string: '-'? (FLOAT | INT | 'Infinity');

// Picks a style for each of the values a property can have: `value "PX" style point1`
CategorizedStyle: 'categorizedstyle' name=StyleName 'property' property=STRING (values+=CategoryValue)+;

CategoryValue: 'categoryvalue' key=STRING 'style' style=[Style:StyleName];

// The style of a layer drawn by the product's GeoServer from colours: `geometry` is POLYGON, LINE or POINT
WMSLayerStyle: 'wmsstyle' name=StyleName 'geometryType' geometryType=ID
  ('fillColor' fillColor=STRING)? ('strokeColor' strokeColor=STRING)?
  ('fillOpacity' fillOpacity=Double)? ('strokeOpacity' strokeOpacity=Double)?
  ('legendLabel' legendLabel=STRING)?;

// The style of a layer drawn by the product's GeoServer from an SLD file (`@include:folder/file.sld` takes it from the product's files) for the geometries it names
WMSLayerSLDStyle: 'sldstyle' name=StyleName (cached?='cachedSld')? ('sld' sld=STRING)? ('sldPath' sldPath=STRING)? (geometries+=StyleGeometry)*;

StyleGeometry: 'sldgeometry' type=ID 'property' property=STRING;
