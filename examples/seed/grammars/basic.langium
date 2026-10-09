grammar Basic
import './common'

// Basic: the product's name, version, SRID, languages, package, database, deployment and feature selection.
//
// This is the root of the product specification: its JSON mapping lays out the whole document, and the other
// metamodels (data model, GIS model, sensors, forms, lists, menus, static pages) fill it in. It needs none of them.
entry BasicModel: 'basic' name=ProductName
  ('version' version=STRING)?
  ('srid' srid=INT)?
  ('languages' languages+=ID (',' languages+=ID)*)?
  ('package' artifactId=ID 'group' groupId=STRING)?
  ('database' Database)?
  ('elastic' ('uris' elasticUris=STRING)? ('login' elasticUser=STRING)? ('password' elasticPassword=STRING)?)?
  ('features' features+=ID (',' features+=ID)*)?
  (extras+=ExtraOption)*;

// The name of the product: a word, or a text in quotes when it has spaces ("Sample product")
ProductName returns string: ID | STRING;

// Where the product's database is: every part is optional, because a product may leave some to the platform's defaults
fragment Database: ('at' dbHost=STRING)? ('port' dbPort=STRING)? ('schema' dbName=STRING)? ('login' dbUser=STRING)? ('password' dbPassword=STRING)?;

// A deployment setting of the product, one per line: `extra client_deploy_url "http://..."`; `geoserver_url`, `server_deploy_port`... Any name, the platform decides which it reads.
ExtraOption: 'extra' key=ID value=STRING;
