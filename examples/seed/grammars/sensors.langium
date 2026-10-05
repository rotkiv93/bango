grammar Sensors
import 'common'
import 'datamodel'
import 'gismodel'

// Sensors: the sensors of the product, with their measurements and dimensions. Needs the data model and the GIS model.
//
// Modeled on @lbdudc/sensor-dsl and the JSON it produces for the product line. A sensor does not repeat what the
// other metamodels already say: the entities it stores data in are data-model entities, and the map and layer it
// opens with are GIS-model ones, all checked as references.
entry SensorModel: 'sensors' name=ID?
  (sensors+=SensorDef | groups+=SensorGroup)*;

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

// A measurement is a property of the fact table entity
Measurement: name=ID dataType=('Long' | 'Boolean' | 'Float' | 'Integer' | 'Double' | 'LocalDate' | 'String' | 'DateTime')
  ('units' units=STRING)?;

Dimension: SpatialDimension | CategoricalDimension;

// Observations are grouped by where they are: a chain of entities, e.g. `spatial Region entities (Country, Ocean)`
SpatialDimension: 'spatial' name=ID 'entities' '(' entities+=[Entity:ID] (',' entities+=[Entity:ID])* ')';

// ... or by a category: a field of the fact table
CategoricalDimension: 'categorical' name=ID 'field' field=ID;

SensorGroup: 'sensorGroup' name=ID '(' sensors+=[SensorDef:ID] (',' sensors+=[SensorDef:ID])* ')';
