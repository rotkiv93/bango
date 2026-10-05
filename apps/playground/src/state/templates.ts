export const CONSTRAINTS_TEMPLATE = `// Extra rules the grammar cannot express. Return { AstTypeName(node, accept) { ... } }.
// accept(severity, message, { node, property, index }) reports a problem on the node.
return {
};
`;

export const SPEC_TEMPLATE = `// How this metamodel's instances become JSON: the piece of the specification it owns.
// Return a function. \`model\` is the root of the instance, \`refName(ref)\` the name a reference points at.
// The pieces of all metamodels are merged into one document.
return function (model, { refName }) {
  return {
    name: model.name
  };
};
`;

export const grammarTemplate = (name: string) => {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  return `grammar ${pascal}
import 'common'

// ${pascal}: describe this metamodel in one line (shown when choosing metamodels for a project)
entry Model: '${name}' name=ID?;
`;
};
