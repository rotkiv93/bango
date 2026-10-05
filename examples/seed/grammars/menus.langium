grammar Menus
import './common'
import './forms'
import './lists'
import './gismodel'

// Menus: the navigation of the product, nested items that open forms, lists or maps. Needs the forms, the lists and the GIS model.
//
// An item opens a screen from one of three metamodels, and may hold more items (the rule is recursive).
entry MenuModel: 'menus' name=ID? (menus+=Menu)*;

// A menu is a named tree of items; `position` says where the product shows it (at the top by default)
Menu: 'menu' name=ID ('position' position=('top' | 'side'))? '{' (items+=MenuItem)+ '}';

// `opens` points at a screen; an item with items of its own groups them
MenuItem: 'item' name=ID ('label' label=STRING)? ('opens' target=[Screen:ID])? ('{' (children+=MenuItem)+ '}')?;

// What an item can open (a type, not a rule: it is only used by a cross-reference)
type Screen = FormDef | ListDef | MapDef;
