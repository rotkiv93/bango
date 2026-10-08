grammar Basic
import './common'

// Basic: the product's name, version, SRID, languages, package, database, deployment and feature selection.
//
// This is the root of the product specification: its JSON mapping lays out the whole document, and the other
// metamodels (data model, GIS model, sensors, forms, lists, menus, static pages) fill it in. It needs none of them.
entry BasicModel: 'basic' name=ID
  ('version' version=STRING)?
  ('srid' srid=INT)?
  ('languages' languages+=ID (',' languages+=ID)*)?
  ('package' artifactId=ID 'group' groupId=STRING)?
  ('database' 'at' dbHost=STRING ('port' dbPort=STRING)? 'schema' dbName=STRING 'login' dbUser=STRING 'password' dbPassword=STRING)?
  ('features' features+=ID (',' features+=ID)*)?
  (extras+=ExtraOption)*;

// A deployment setting of the product, one per line: `extra client_deploy_url "http://..."`; `geoserver_url`, `server_deploy_port`... Any name, the platform decides which it reads.
ExtraOption: 'extra' key=ID value=STRING;
