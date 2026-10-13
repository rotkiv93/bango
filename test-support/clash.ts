/**
 * Metamodels that clash with the shipped ones. They are written independently of the data model, so they call their
 * own things `Entity` too: when a project uses both, the composer has to tell them apart.
 */

/** declares `Entity` (and `Link` to it), like the data model does */
export const OTHER_GRAMMAR = `grammar Other
import 'common'

// Other: a second metamodel that also calls its things Entity
entry Top: 'other' name=ID? (items+=Entity | links+=Link)*;

Entity: 'e' name=ID ('note' note=STRING)?;

Link: 'link' target=[Entity:ID];
`;

export const OTHER_INSTANCE = `other tops
e Foo note "only here"
e Bar
link Foo
`;

/** imports Other and refers to its Entity, so it is rewritten when Other's Entity is renamed */
export const USES_GRAMMAR = `grammar Uses
import 'common'
import 'other'

// Uses: refers to the entities of Other
entry Usage: 'uses' (uses+=Use)*;

Use: 'use' name=ID 'of' target=[Entity:ID];
`;

/** two grammars that declare the same interface */
export const SHARED_A = `grammar SharedA
import 'common'

// SharedA: declares the interface Shared
entry RootA: 'a' (things+=ThingA)*;
interface Shared { name: string }
ThingA returns Shared: name=ID;
`;

export const SHARED_B = `grammar SharedB
import 'common'

// SharedB: declares the interface Shared too
entry RootB: 'b' (things+=ThingB)*;
interface Shared { name: string }
ThingB returns Shared: name=ID;
`;
