grammar Basic
import './common'

// Basic: the product's name, SRID, index page, languages, package, database and feature selection.
//
// This is the root of the product specification: its JSON mapping lays out the whole document, and the other
// metamodels (data model, GIS model, sensors, forms, lists) fill it in. It needs none of them.
entry BasicModel: 'basic' name=ID
  ('srid' srid=INT)?
  ('index' indexComponent=ID indexView=ID)?
  ('languages' languages+=ID (',' languages+=ID)*)?
  ('package' artifactId=ID 'group' groupId=STRING)?
  ('database' 'at' dbHost=STRING 'schema' dbName=STRING 'login' dbUser=STRING 'password' dbPassword=STRING)?
  ('features' features+=ID (',' features+=ID)*)?;
