// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// The fields of a form are the fields of its entity. (Return undefined to leave the choice to the default scope, which is every
// exported node of the right type: that is not what is wanted for fields, which belong to their entity.)
/** @type {Scope} */
const scope = {
  FormField: {
    property: field => field.$container.entity?.ref?.fields ?? []
  }
};

return scope;
