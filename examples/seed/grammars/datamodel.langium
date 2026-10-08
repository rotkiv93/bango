grammar DataModel
import './common'

// Data model: entities made of property fields and relationship fields, and the enumerations they use.
// The words this grammar reserves (`entity`, `enum`, `extends`, `abstract`, `traceable`, `display`, `min`, `max`, `pattern` and the
// names of the basic types) cannot be used as names.
entry Model: 'datamodel' name=ID? (entities+=Entity | enums+=EnumDef)*;

// A set of named values; a property uses it as its `class`
EnumDef: 'enum' name=ID '{' values+=ID (',' values+=ID)* '}';

// `abstract` entities are never created on their own; `extends` takes the fields of another entity; `traceable` keeps a history of changes.
// `display "$id"` is the template that shows an entity to people; `$field` refers to one of its fields
Entity: (abstract?='abstract')? 'entity' name=ID ('extends' superclass=[Entity:ID])? ('display' displayString=STRING)? (traceable?='traceable')?
  '{' (fields+=Field)* '}';

Field: PropertyField | RelationshipField;

// The type is a basic one or an enumeration of the model (`enumType`, a reference: renaming the enumeration renames its uses).
// `autoinc` makes a numeric key generate itself.
// `pattern` limits a String to an IP, an URL, an Email (datamodel.constraints.js) or to a regular expression in quotes;
// `min` and `max` limit its length or a number's value
PropertyField: 'property' name=ID ':' (class=BasicType | enumType=[EnumDef:ID])
  (autoinc?='autoinc')? (required?='required')? (pk?='pk')? (unique?='unique')?
  ('pattern' (patternType=ID | pattern=STRING))? ('min' min=SignedNumber)? ('max' max=SignedNumber)?;

BasicType returns string: 'Boolean' | 'Integer' | 'Long' | 'Float' | 'Double' | 'String' | 'Text' | 'Date' | 'DateTime' | 'LocalDate'
  | 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon' | 'Geometry' | 'GCAddress' | 'IGGallery';

// `inverse` names the field of the target that points back; exactly one side of a pair is the `owner`
RelationshipField: 'relation' name=ID '->' target=[Entity:ID] ('inverse' bidirectional=ID)?
  (owner?='owner')? (multiple?='multiple')? (required?='required')?;
