grammar Sensors
import './common'
import './datamodel'
import './gismodel'

// Sensors: the sensors of the product, with their measurements and dimensions. Needs the data model and the GIS model.
//
// Modeled on @lbdudc/sensor-dsl and the JSON it produces for the product line. A sensor does not repeat what the
// other metamodels already say: the entities it stores data in are data-model entities, the map and layer it opens
// with (and where the map opens: its `center`) are GIS-model ones, all checked as references.
entry SensorModel: 'sensors' name=ID?
  (ranges+=SensorRange | sensors+=SensorDef | groups+=SensorGroup)*;

// A named list of labelled values, to read a measurement or to split observations by category.
//   range Level { default as "other"  0 to 10 as "low"  high as "High value" }
SensorRange: 'range' name=ID '{' (buckets+=RangeBucket)* '}';

// One label: for what is not any other (`default`), for the numbers from `min` to `max`, or for one value
RangeBucket: (default?='default' | min=SignedNumber 'to' max=SignedNumber | value=ID) 'as' label=STRING;

// A sensor measures `measurements` into its `factTable` entity, one row per observation of an `entity`
SensorDef: (moving?='moving')? 'sensor' name=ID
  'time' time=INT
  'geometry' geom=('Point' | 'MultiPoint' | 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString')
  'entity' entity=[Entity:ID]
  'factTable' factTable=[Entity:ID]
  'map' defaultMap=[MapDef:ID]
  'layer' defaultLayer=[GeoJsonLayer:ID]
  '{'
    'measurements' (measureData+=Measurement)+
    (dimensions+=Dimension)*
  '}';

// A measurement is a property of the fact table entity. `icon` is a Material icon name; `range` labels its values
Measurement: name=ID dataType=('Long' | 'Boolean' | 'Float' | 'Integer' | 'Double' | 'LocalDate' | 'String' | 'DateTime')
  ('units' units=STRING)? ('icon' icon=STRING)? ('range' range=[SensorRange:ID])?;

Dimension: SpatialDimension | CategoricalDimension;

// Observations are grouped by where they are: a chain of entities, e.g. `spatial Region entities (Country, Ocean)`
SpatialDimension: 'spatial' name=ID 'entities' '(' entities+=[Entity:ID] (',' entities+=[Entity:ID])* ')';

// ... or by a category: a property of the fact table (sensors.scope.js), whose values the `range` names
CategoricalDimension: 'categorical' name=ID 'field' field=[PropertyField:ID] ('range' range=[SensorRange:ID])?;

SensorGroup: 'sensorGroup' name=ID '(' sensors+=[SensorDef:ID] (',' sensors+=[SensorDef:ID])* ')';
