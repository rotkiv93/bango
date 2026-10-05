grammar DataModel
import 'common'

// Data model: entities made of property fields and relationship fields
entry Model: 'datamodel' name=ID? (entities+=Entity)*;

// `display "$id"` is the template that shows an entity to people; `$field` refers to one of its fields
Entity: 'entity' name=ID ('display' displayString=STRING)?
  '{' (fields+=Field)+ '}';

Field: PropertyField | RelationshipField;

// `class` is the type: String, Double, Polygon, ...; `autoinc` makes a numeric key generate itself
PropertyField: 'property' name=ID ':' class=ID
  (autoinc?='autoinc')? (required?='required')? (pk?='pk')? (unique?='unique')?;

// `inverse` names the field of the target that points back; exactly one side of a pair is the `owner`
RelationshipField: 'relation' name=ID '->' target=[Entity:ID] ('inverse' bidirectional=ID)?
  (owner?='owner')? (multiple?='multiple')? (required?='required')?;
