/**
 * A composite metamodel: a grammar that imports other metamodels and mixes their rules in one document.
 * It is not one of the shipped metamodels, so tests that cover composites define it themselves.
 */
export const COMBO_GRAMMAR = `grammar Combo
import 'common'
import 'datamodel'
import 'gismodel'

// Combo: data-model and GIS-model definitions in one document
entry Combined: 'combo' name=ID?
  (entities+=Entity | maps+=MapDef | layers+=Layer | styles+=Style)*;
`;

export const COMBO_INSTANCE = `combo demo

entity Building display "Building" {
  property name: String required pk
  property geometry: Polygon
}

geojsonstyle outline fillColor "#ccc" strokeColor "#333" fillOpacity 0.4 strokeOpacity 1.0 radius 3.0
geojsonlayer buildings entity Building defaultStyle outline availableStyles outline
`;
