/** The starting point of each file a metamodel can own. They show the conventions: the typed `@type` line, the helpers, `return`. */

export const CONSTRAINTS_TEMPLATE = `// Extra rules the grammar cannot express: a function per AST type name, called for every node of that type.
// accept(severity, message, { node, property, index }) reports a problem on the node.
// \`Constraints\` and the types of this metamodel's nodes come from its grammar: try \`node.\` for completion.
// Helpers: typeName(node), refName(ref), duplicates(items, key).
/** @type {Constraints} */
const constraints = {
};

return constraints;
`;

export const SPEC_TEMPLATE = `// How this metamodel's instances become JSON: the piece of the specification it owns.
// \`model\` is the root of the instance, \`refName(ref)\` the name a reference points at.
// The pieces of all metamodels are merged into one document.
/** @type {Spec} */
const spec = function (model, { refName }) {
  return {
    name: model.name
  };
};

return spec;
`;

export const IMPORT_TEMPLATE = `// The inverse of the JSON mapping: how the project's JSON becomes this metamodel's instance.
// \`json\` is the whole project document. Describe the instance with n('NodeType', { feature: value, ... }):
// text and numbers as they are, a reference as the name it points at, a child as another n(...), a flag as true or false.
// Features left out (or undefined) are not written.
/** @type {Import} */
const importer = function (json, { n }) {
  return n('Model', {
  });
};

return importer;
`;

/** A minimal metamodel: imports the shared terminals, has one entry rule, and describes itself in the first comment. */
export const grammarTemplate = (name: string) => {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  return `grammar ${pascal}
import 'common'

// ${pascal}: describe this metamodel in one line (shown when choosing metamodels for a project)
entry Model: '${name}' name=ID?;
`;
};
