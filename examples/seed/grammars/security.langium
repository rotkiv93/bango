grammar Security
import 'common'
import 'datamodel'
import 'forms'
import 'lists'

// Security: users, roles and what each role may do with entities, forms and lists. Needs the data model, the forms and the lists.
//
// A permission points at a "resource", which is an entity, a form or a list: three types from three different metamodels behind one
// reference. Forms and lists both import the data model, so it reaches this grammar along three paths.
entry SecurityModel: 'security' name=ID?
  (roles+=Role | users+=User | grants+=Grant)*;

// A role may extend others (`extends viewer, auditor`): it has everything they have
Role: 'role' name=ID ('extends' parents+=[Role:ID] (',' parents+=[Role:ID])*)?;

User: 'user' name=ID ('email' email=STRING)? 'roles' roles+=[Role:ID] (',' roles+=[Role:ID])*;

// What a role may do with a resource: `grant clerk write on InvoiceForm`
Grant: 'grant' role=[Role:ID] access=('read' | 'write' | 'admin') 'on' resource=[Resource:ID];

// Anything a permission can be about, wherever it is declared (a type, not a rule: it is only used by a cross-reference)
type Resource = Entity | FormDef | ListDef;
