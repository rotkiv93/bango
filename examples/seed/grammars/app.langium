grammar App
import 'common'
import 'datamodel'
import 'mapviewer'

// Composite: data-model and map-viewer definitions in one document
// It declares no rules of its own besides the entry, everything is reused from the imported metamodels.
entry Application: 'app' name=ID?
  (entities+=Entity | maps+=MapDef | layers+=Layer | styles+=Style)*;
