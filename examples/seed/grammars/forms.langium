grammar Forms
import './common'
import './datamodel'

// Forms: data-entry forms over data-model entities. Optional in a product; needs the data model.
entry FormModel: 'forms' (forms+=FormDef)*;

// A form edits one entity. List the fields to show, or leave the block out to show all of them.
FormDef: 'form' name=ID ('label' label=STRING)? 'entity' entity=[Entity:ID]
  ('{' (fields+=FormField)* '}')?;

// `property` is a field of the form's entity: forms.scope.js says which ones are visible there
FormField: 'field' property=[Field:ID] ('label' label=STRING)? (readOnly?='readOnly')?;
