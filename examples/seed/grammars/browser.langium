grammar Browser
import './common'
import './datamodel'

// Lists and forms: how a product shows and edits its data, one list and one form over each data-model entity. Optional in a product; needs the data model.
entry BrowserModel: 'browser' (forms+=FormDef | lists+=ListDef)*;

// A form edits one entity. Its name may have spaces (`"Customer Form"`). The `allow...` words say what a person can do with it,
// `confirmRemove` asks before removing. The block lists the fields it shows.
FormDef: 'form' name=Name 'entity' entity=[Entity:ID] (abstract?='abstract')?
  (allowCreate?='allowCreate')? (allowEdit?='allowEdit')? (allowRemove?='allowRemove')? (confirmRemove?='confirmRemove')?
  ('{' (fields+=FormField)* '}')?;

// `property` is a field of the form's entity: browser.scope.js says which ones are visible there. `viewed` shows it, `edited` lets it be changed
FormField: 'field' property=[Field:FieldName] (viewed?='viewed')? (edited?='edited')?;

// A list shows one entity; its name may have spaces (`"Customer List"`). `opensForm` is the form its rows open, `removeLink` puts a remove link
// on each row, and `sorting`, `searching` and `filtering` say what a person can do with it. The block lists the columns it shows.
ListDef: 'list' name=Name 'entity' entity=[Entity:ID] (abstract?='abstract')? ('opensForm' form=[FormDef:Name])?
  (removeLink?='removeLink')? (sorting?='sorting')? (searching?='searching')? (filtering?='filtering')?
  ('{' (columns+=ListColumn)* '}')?;

// `property` is a field of the list's entity. `opensForm` is the form a click on the column opens, when it is not the form of the list
// (the column of a relationship opens the form of the other entity)
ListColumn: 'column' property=[Field:FieldName] ('opensForm' form=[FormDef:Name])?;
