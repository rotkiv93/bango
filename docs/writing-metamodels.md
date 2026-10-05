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
- **`import` is how metamodels depend on each other.** Importing `datamodel` makes `gismodel` *require* it: a project that selects `gismodel` without `datamodel` is rejected, with the message `'gismodel' needs 'datamodel': add 'datamodel' to this project`.
- **A cross-reference to an imported type is a cross-metamodel reference.** `entity=[Entity:ID]` in `gismodel` resolves to an entity in the *data-model instance*. Nothing else is needed.
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
- **Type names are global within a project** (the metamodels share one index), but you do not have to avoid clashes: see [When two metamodels use the same type name](#when-two-metamodels-use-the-same-type-name).
- **Reference names are looked up globally by type.** Two `Entity` nodes with the same name in one project collide. Fields nested inside an entity are not global, so `id` in every entity is fine.
- **A `?=` flag that is not written is `false`, but may be absent from the node.** In constraints and mappings, use `!!node.flag`.
- **Whitespace is insignificant.** Use blocks (`{ ... }`) or keywords to delimit lists, not newlines.

## 2. Constraints

Constraints report what the grammar cannot: uniqueness, "this default must be one of those", and anything that needs two metamodels to be said. The file is a function body that returns an object whose keys are **AST type names** (the rule names) and whose values check one node:

```js
// datamodel.constraints.js
/** @type {Constraints} */
const constraints = {
  Entity(entity, accept) {
    const pks = entity.fields.filter(f => f.$type === 'PropertyField' && f.pk);
    if (pks.length !== 1) {
      accept('warning', `entity '${entity.name}' should have exactly one pk property (found ${pks.length})`, {
        node: entity,
        property: 'name'
      });
    }
    for (const { item, index } of duplicates(entity.fields, f => f.name)) {
      accept('error', `duplicate field '${item.name}'`, { node: entity, property: 'fields', index });
    }
  }
};

return constraints;
```

The `/** @type {Constraints} */` line is what gives the editor the types: `Constraints` (and one interface per AST type, with its properties) is generated from the grammar, so `entity.` completes to `fields`, `name`, ... and a misspelled property is underlined. It is optional: without it the file works the same, just without help. A few things that help the checker follow what you mean:

- Narrow a union with `filter` before `find`: `entity.fields.filter(f => f.$type === 'PropertyField').find(f => f.name === n)` is typed as a `PropertyField`, while `find(f => f.$type === '...' && ...)` is not.
- References are `Ref<T>`: `ref.ref` is the target or `undefined`.

`accept(severity, message, { node, property, index })`:

- `severity`: `'error'`, `'warning'`, `'info'` or `'hint'`. Errors fail a build; warnings are reported but do not.
- `node` is the node to mark; `property` narrows it to one feature (and `index` to one item of a list).

Helpers you can call without importing anything:

| | |
|---|---|
| `duplicates(items, key?)` | the items that repeat the key of an earlier one, as `{ item, index }`: the usual "names must be unique" check |
| `refName(ref)` | the name a reference points at, or the text as written when it does not resolve |
| `typeName(node)` | the type of a node as its author wrote it (see [type name clashes](#when-two-metamodels-use-the-same-type-name)) |

Inside a check:

- Children are plain properties (`entity.fields`); `$type` is the rule name.
- A reference is an object: `ref.ref` is the target node (or `undefined` if it does not resolve) and `ref.$refText` the text that was written. Cross-metamodel references need no special handling: `sensor.entity.ref.fields` reaches into the data model.
- Check for `undefined` before using a reference target: while someone is typing, references do not resolve.

A metamodel's constraints apply to its own instances and to the instances of any **composite** metamodel that imports it (a grammar that imports `datamodel` and `gismodel` and mixes their rules in one document, say). If the file has a syntax error, or does not return an object of functions, the problem is reported on the metamodel (`<name>.constraints.js: ...`) and the other metamodels keep working.

Example of a rule that crosses metamodels (`sensors`, which needs the data model and the GIS model):

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

## When two metamodels use the same type name

Independent metamodels tend to pick the same names (`Entity`, `Layer`, `Field`, `Model`). The metamodels of one project share one index and one merged type reflection, both keyed by type name, so two different `Entity` types would mix their scopes and overwrite each other's properties. **The composer works around it, so you don't have to coordinate names.**

When a selection of metamodels declares the same type name in different grammar files, one keeps the name and the others get a new one:

- **Who keeps it**: the grammar included by the most metamodels of the project (the data model that others import, say). Ties go to the first by name.
- **The new name** is the grammar's name in PascalCase in front of the old one: `other`'s `Entity` becomes `OtherEntity` (`OtherEntity2` if that is taken too).
- **What counts as a type**: parser rules (or the name they `infer`), `interface` and `type` declarations. Terminals, data type rules (`returns number`) and fragments declare no AST type, and a rule that `returns` an existing type does not declare one either.
- **Everywhere in the composition**: the declaration and every reference to it, including in grammars that import it (`[Entity:ID]` in an importer becomes `[OtherEntity:ID]`). Only identifiers change, so the grammar means the same thing.
- **Only when both are in the project.** A metamodel alone, or with metamodels it does not clash with, keeps the names it was written with, and a project's names do not leak into another.

What does **not** change: the text of your grammars and instances (you keep writing `e Foo`, not `OtherEntity`), their error positions, and the keywords. What does: the `$type` of the renamed nodes (`OtherEntity`), which shows in the form view, the generic JSON and the AST view.

In constraints and JSON mappings:

- **Constraint keys** are translated for you: `Entity(node, accept) { ... }` in `other.constraints.js` checks `other`'s `Entity` (now `OtherEntity`), and never the data model's.
- **`typeName(node)`** returns the name of a node's type as its author wrote it. Use it instead of `node.$type` when you test the type (`typeName(field) === 'PropertyField'`), so your code does not care whether a name was changed.

It is reported, not hidden: the grammar that was renamed gets an *info* (`Type 'Entity' is also declared by 'datamodel': in a project that uses both it is called 'OtherEntity'`), the composition lists them in `renames`, and the playground's project overview shows a notice.

## 3. The JSON mapping

The mapping turns an instance into the piece of the project's JSON that the metamodel owns. See [The JSON specification](json-spec.md) for the whole picture; the file itself is a function:

```js
// datamodel.spec.js
/** @type {Spec} */
const spec = function (model, { refName }) {
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

return spec;
```

`Spec` is typed from the grammar too: `model` is the type of the entry rule.

- `model` is the root node of the instance (the entry rule's node).
- `typeName(node)` is available too (see [type name clashes](#when-two-metamodels-use-the-same-type-name)).
- `refName(ref)` returns the name a reference points at (or the written text when it does not resolve). Use it instead of `ref.ref.name`.
- Return plain JSON. The result goes through `JSON.stringify`, so functions and `undefined` values disappear and nothing else can leak out.
- Throwing is fine: the failure is reported as `The JSON mapping of '<name>' failed: ...` in the JSON views and fails a build.
- Write `return { root: true, map(model, { refName }) { ... } }` (typed as `Spec` as well) instead of a bare function for the mapping that lays out the whole document: it is merged first, so its key order becomes the document's (see [Key order](json-spec.md#key-order)). `basic` does this.
- Without a mapping file, a metamodel's JSON is the generic tree (and it is left out of the merged project document).

## 4. Trying it

1. Open the playground, go to **Metamodels**, and create one (*+ New metamodel*): it starts from a minimal grammar that imports `common`.
2. Edit the grammar; the problems list shows grammar errors as you type.
3. Add it to a project (*Manage metamodels*), create its instance and write some text. Completion offers the keywords and the references that exist in the project.
4. Add constraints and a mapping (the *Constraints* and *JSON mapping* tabs create a starting file).
5. *Composed* shows the grammar exactly as the composer builds it, with every import inlined.
6. *Tests* keeps sample instances and what they must report (below), so you can keep changing the grammar and the constraints with a safety net.

## 5. Testing a metamodel

A **test case** is a sample instance and the problems it must have:

```json
{
  "name": "a field name cannot repeat",
  "text": "datamodel shop\nentity Road {\n  property name: String pk\n  property name: String\n}\n",
  "expect": { "errors": ["duplicate field 'name'"] }
}
```

- `expect.errors` are the errors the sample must report, each a piece of the message, **no more and no fewer**. Leave it out and the sample must have no errors at all.
- `expect.warnings` works the same way, but only when you list it: without it, warnings are not checked. `"warnings": []` says there must be none.
- `with` gives instances of the metamodels this one needs, by name, for samples that refer to them: `"with": { "datamodel": "datamodel d\nentity Road { ... }" }`.

The **Tests** tab of a metamodel lists its cases, reruns them as you edit the grammar, constraints or mapping, and offers *Expect what it reports* on a failing case, to turn what you see into the expectation. In code it is `bango.runCases(metamodel, cases)`: it composes the metamodel with what it requires in an engine of its own, so the project you have open is not touched. The shipped metamodels keep theirs in `examples/seed/grammars/<name>.cases.json`, and a test runs all of them.

## Checklist

- [ ] one `entry` rule, and a one-line `//` description
- [ ] every node you want to point at has `name=ID`
- [ ] rule names are unique across all metamodels
- [ ] each metamodel it needs is `import`ed (that is what makes it a requirement)
- [ ] constraints for what only a person would notice
- [ ] a few test cases: one valid sample, and one for each rule
- [ ] a mapping, if the metamodel contributes to the JSON specification
