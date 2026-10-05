# Writing metamodels

A metamodel is up to three files, named after it. Only the grammar is required.

| File | What it is | Loaded with |
|---|---|---|
| `<name>.langium` | the grammar: what instances look like | `bango.setGrammar(name, text)` |
| `<name>.constraints.js` | validation the grammar cannot express | `bango.setConstraints(name, code)` |
| `<name>.spec.js` | how an instance becomes JSON | `bango.setSpec(name, code)` |

In the playground, all three are edited on the **Metamodels** page (*Grammar*, *Constraints*, *JSON mapping*), and every project that uses the metamodel revalidates as you type.

## 1. The grammar

```langium
grammar DataModel
import 'common'

// Data model: entities made of property fields and relationship fields
entry Model: 'datamodel' name=ID? (entities+=Entity)*;

Entity: 'entity' name=ID ('display' displayString=STRING)? '{' (fields+=Field)+ '}';
Field: PropertyField | RelationshipField;
PropertyField: 'property' name=ID ':' class=ID (pk?='pk')?;
RelationshipField: 'relation' name=ID '->' target=[Entity:ID];
```

How Bango reads it:

- **The entry rule makes it a metamodel.** A grammar without an `entry` rule is a *library* (like `common`, with the shared terminals) and cannot be selected for a project.
- **Instances use the extension `.<grammar name lowercased>`**: `grammar DataModel` gives `.datamodel`. Two grammars with the same declared name would share an extension, which the composer reports as an error.
- **The first `//` comment is the description** shown when choosing metamodels for a project. Make it one clear line.
- **`import` is how metamodels depend on each other.** Importing `datamodel` makes `mapviewer` *require* it: a project that selects `mapviewer` without `datamodel` is rejected, with the message `'mapviewer' needs 'datamodel': add 'datamodel' to this project`.
- **A cross-reference to an imported type is a cross-metamodel reference.** `entity=[Entity:ID]` in `mapviewer` resolves to an entity in the *data-model instance*. Nothing else is needed.
- **Import `common` for terminals.** It defines `ID` (letters, digits, `_`, and `-` after the first character), `INT`, `FLOAT`, `STRING`, the `Double` and `SignedNumber` data types, whitespace and comments.

### Conventions that make the tooling better

| In the grammar | What you get |
|---|---|
| `name=ID` on a rule | its nodes are references targets, and appear as nodes in the diagram |
| `flag?='keyword'` | a checkbox in the form, a `true`/`false` in the instance |
| `kind=('A' \| 'B' \| 'C')` (inline keywords) | a drop-down in the form |
| `x=[Type:ID]` | a drop-down of every `Type` in the project, across metamodels, and completion in the text |
| `items+=Item` | a list with *add* and *remove* in the form |
| `Layer: A \| B \| C` (a rule that only picks) | the form offers *+ A*, *+ B*, *+ C* |
| `STRING` for text, `INT`/`Double` for numbers | a text or number input |

### Pitfalls

- **Keywords are reserved words.** `'entity'` in a grammar means no instance can have an identifier called `entity`. Prefer specific keywords (`baseLayer` rather than `base`) so ordinary names stay free.
- **Rule names are global** across metamodels (they share one index). Don't reuse `Entity` or `Layer` in another grammar; the composer warns if you do.
- **Reference names are looked up globally by type.** Two `Entity` nodes with the same name in one project collide. Fields nested inside an entity are not global, so `id` in every entity is fine.
- **A `?=` flag that is not written is `false`, but may be absent from the node.** In constraints and mappings, use `!!node.flag`.
- **Whitespace is insignificant.** Use blocks (`{ ... }`) or keywords to delimit lists, not newlines.

## 2. Constraints

Constraints report what the grammar cannot: uniqueness, "this default must be one of those", and anything that needs two metamodels to be said. The file returns an object whose keys are **AST type names** (the rule names) and whose values check one node:

```js
// datamodel.constraints.js
return {
  Entity(entity, accept) {
    const pks = entity.fields.filter(f => f.$type === 'PropertyField' && f.pk);
    if (pks.length !== 1) {
      accept('warning', `entity '${entity.name}' should have exactly one pk property (found ${pks.length})`, {
        node: entity,
        property: 'name'
      });
    }
  }
};
```

`accept(severity, message, { node, property, index })`:

- `severity`: `'error'`, `'warning'`, `'info'` or `'hint'`. Errors fail a build; warnings are reported but do not.
- `node` is the node to mark; `property` narrows it to one feature (and `index` to one item of a list).

Inside a check:

- Children are plain properties (`entity.fields`); `$type` is the rule name.
- A reference is an object: `ref.ref` is the target node (or `undefined` if it does not resolve) and `ref.$refText` the text that was written. Cross-metamodel references need no special handling: `sensor.entity.ref.fields` reaches into the data model.
- Check for `undefined` before using a reference target: while someone is typing, references do not resolve.

A metamodel's constraints apply to its own instances and to the instances of any **composite** metamodel that imports it (like `app`, which mixes the data model and the map viewer in one document). If the file has a syntax error, or does not return an object of functions, the problem is reported on the metamodel (`<name>.constraints.js: ...`) and the other metamodels keep working.

Example of a rule that crosses metamodels (`sensors`, which needs the data model and the map viewer):

```js
// the layer that shows a sensor must show the entity the sensor stores into
SensorDef(sensor, accept) {
  const entity = sensor.entity?.ref;
  const layer = sensor.defaultLayer?.ref;
  if (entity && layer?.entity?.ref && layer.entity.ref !== entity) {
    accept('error', `layer '${layer.name}' shows entity '${layer.entity.ref.name}', but sensor '${sensor.name}' stores in '${entity.name}'`, {
      node: sensor,
      property: 'defaultLayer'
    });
  }
}
```

## 3. The JSON mapping

The mapping turns an instance into the piece of the project's JSON that the metamodel owns. See [The JSON specification](json-spec.md) for the whole picture; the file itself is a function:

```js
// datamodel.spec.js
return function (model, { refName }) {
  return {
    data: {
      dataModel: {
        entities: model.entities.map(entity => ({
          name: entity.name,
          properties: entity.fields.map(field => ({ name: field.name, class: field.class }))
        }))
      }
    }
  };
};
```

- `model` is the root node of the instance (the entry rule's node).
- `refName(ref)` returns the name a reference points at (or the written text when it does not resolve). Use it instead of `ref.ref.name`.
- Return plain JSON. The result goes through `JSON.stringify`, so functions and `undefined` values disappear and nothing else can leak out.
- Throwing is fine: the failure is reported as `The JSON mapping of '<name>' failed: ...` in the JSON views and fails a build.
- Without a mapping file, a metamodel's JSON is the generic tree (and it is left out of the merged project document).

## 4. Trying it

1. Open the playground, go to **Metamodels**, and create one (*+ New metamodel*): it starts from a minimal grammar that imports `common`.
2. Edit the grammar; the problems list shows grammar errors as you type.
3. Add it to a project (*Manage metamodels*), create its instance and write some text. Completion offers the keywords and the references that exist in the project.
4. Add constraints and a mapping (the *Constraints* and *JSON mapping* tabs create a starting file).
5. *Composed* shows the grammar exactly as the composer builds it, with every import inlined.

## Checklist

- [ ] one `entry` rule, and a one-line `//` description
- [ ] every node you want to point at has `name=ID`
- [ ] rule names are unique across all metamodels
- [ ] each metamodel it needs is `import`ed (that is what makes it a requirement)
- [ ] constraints for what only a person would notice
- [ ] a mapping, if the metamodel contributes to the JSON specification
