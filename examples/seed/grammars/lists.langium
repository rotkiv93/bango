grammar Lists
import './common'
import './datamodel'

// Lists: tables of data-model entities, with the columns to show and how to sort them. Optional in a product; needs the data model.
entry ListModel: 'lists' (lists+=ListDef)*;

// A list shows one entity. List the columns to show, or leave the block out to show all of them.
ListDef: 'list' name=ID ('label' label=STRING)? 'entity' entity=[Entity:ID]
  ('pageSize' pageSize=INT)?
  ('sortBy' sortBy=[Field:ID] (descending?='descending')?)?
  ('{' (columns+=ListColumn)* '}')?;

// `property` (and `sortBy`) is a field of the list's entity: lists.scope.js says which ones are visible there
ListColumn: 'column' property=[Field:ID] ('label' label=STRING)?;
