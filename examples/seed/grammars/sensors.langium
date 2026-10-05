grammar Sensors
import 'common'
import 'datamodel'
import 'mapviewer'

// Sensors: the product and its sensors with their dimensions. Needs the data model and the map viewer.
//
// This is the root of the product specification (modeled on @lbdudc/sensor-dsl and the JSON it produces for the
// product line). A sensor does not repeat what the other metamodels already say: the entities it stores data in are
// data-model entities, and the map and layer it opens with are map-viewer ones, all checked as references.
entry SensorModel: 'sensors' name=ID?
  product=SensorProduct?
  (sensors+=SensorDef | groups+=SensorGroup)*;

// `data.basicData` and the feature selection. Languages, package and index have the DSL's defaults when left out.
SensorProduct: 'product' name=ID ('srid' srid=INT)?
  ('index' indexComponent=ID indexView=ID)?
  ('languages' languages+=ID (',' languages+=ID)*)?
  ('package' artifactId=ID 'group' groupId=STRING)?
  ('database' 'at' dbHost=STRING 'schema' dbName=STRING 'login' dbUser=STRING 'password' dbPassword=STRING)?
  ('features' features+=ID (',' features+=ID)*)?;

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
