# The JSON specification

Every instance can be read as JSON, and so can a whole project. There are two formats.

| Format | What it is | When |
|---|---|---|
| **mapping** (default) | the metamodel's own JSON mapping, `<metamodel>.spec.js`: the shape *you* define | to produce a document another tool consumes |
| **generic** | the instance as a plain tree, the same shape for every metamodel | to inspect any instance, or when a metamodel has no mapping |

A metamodel that has no mapping is read as the generic tree.

## The mapping: one piece per metamodel

Each metamodel owns **a part** of the project's document and says how to produce it. The three example metamodels split one product specification like this:

| Metamodel | Owns |
|---|---|
| `datamodel` | `data.dataModel` |
| `mapviewer` | `data.mapViewer` |
| `sensors` | `features`, `data.basicData`, `data.dataWarehouse`, and the still-empty `data.forms`, `data.lists`, `data.menus`, `data.statics` |

```ts
await bango.toJson('datamodel');   // { data: { dataModel: { entities: [...], enums: [] } } }
await bango.toJson('mapviewer');   // { data: { mapViewer: { maps: [...], layers: [...], styles: [...] } } }
await bango.toJson('sensors');     // { features: [...], data: { basicData: {...}, dataModel: {}, dataWarehouse: {...}, ... } }
```

Writing the mapping is described in [Writing metamodels](writing-metamodels.md#3-the-json-mapping).

## The project: pieces merged into one document

```ts
await bango.toProjectJson();                   // all pieces merged: one JSON document
await bango.toProjectJson({ merge: false });   // { datamodel: {...}, mapviewer: {...}, sensors: {...} }
(await bango.build('gresint')).model.spec;     // the merged document, for a project that builds
```

The three instances of `examples/seed/projects/gresint`, merged, are **exactly** [`examples/seed/expected/sensors_gresint.json`](../examples/seed/expected/sensors_gresint.json): the same keys in the same order, so even the text is identical. A test (`packages/engine/test/spec.test.ts`) checks it.

### How merging works

- **Objects** are merged key by key, recursively.
- **Arrays** are concatenated.
- **Equal values** are kept.
- **Two different values for the same path are an error** that names the path (`Cannot merge the specs: both define data.name ("a" and "b")`). Each metamodel is supposed to own its part, so a conflict means two mappings claim the same thing. A failed merge also fails `build()`.
- **Metamodels without a mapping** (like the composite `app`) are left out of the merged document; with `merge: false` they are listed in the generic shape.
- **Metamodels outside the project, and metamodels with no instance**, contribute nothing.

### Key order

Merging is independent of the order of the pieces, but the *key order* of the result is not. The engine merges metamodels that **need others first**: `sensors` needs the data model and the map viewer, so it is the root of the document and its key order becomes the document's order. It leaves empty slots for the parts the others fill:

```js
// sensors.spec.js
data.basicData = ...;
data.dataModel = {};          // filled by datamodel
data.dataWarehouse = ...;
data.forms = []; data.lists = []; data.menus = [];
data.mapViewer = {};          // filled by mapviewer
data.statics = [];
```

An empty object merges with anything, so the slots cost nothing, and the merged text comes out in the order the specification expects.

## The generic format

`toJson(metamodel, { format: 'generic' })`: every node is an object, in a fixed order: `$type`, then `name`, then its other values, then references, then children. Empty lists and `null` values are left out; `false` flags are kept.

```json
{
  "$type": "SensorDef",
  "name": "StationObservation",
  "time": 10,
  "entity": { "$ref": "StationObservationEntity", "$type": "Entity", "$in": "datamodel" },
  "measureData": [ { "$type": "Measurement", "name": "value", "dataType": "Double" } ]
}
```

A reference is `{ "$ref": "<name>", "$type": "<type of the target>", "$in": "<metamodel that holds it>" }`, or `{ "$ref": "Nope", "$unresolved": true }` when it does not resolve.

### Options

```ts
interface JsonSpecOptions {
  format?: 'spec' | 'generic';      // default 'spec'
  merge?: boolean;                  // project JSON only: merged document (default) or one entry per metamodel
  refs?: 'detailed' | 'names';      // generic: references as { $ref, $type, $in } (default) or just the name
  types?: boolean;                  // generic: include $type (default true)
  ranges?: boolean;                 // generic: include $range [startLine, startColumn, endLine, endColumn] (default false)
}
```

With `format: 'generic'` the project JSON cannot be merged (every tree has its own `$type`), so `toProjectJson` always returns one entry per metamodel.

## When a mapping fails

A mapping that throws rejects with `The JSON mapping of '<metamodel>' failed: <reason>`. The JSON views show that message in place of the document, `build()` fails with it, and a mapping that is not a function (or has a syntax error) is reported as a problem of the metamodel, which then falls back to the generic tree.

## In the playground

- A metamodel tab's **JSON** view shows that instance's piece.
- The overview's **JSON** view shows the merged project document, with *Merged document / One per metamodel* and *Mapping / Generic tree* choices.
- After a build, **Download JSON spec** saves the merged document as `<project>.json`.
- The **JSON mapping** tab on the Metamodels page edits a mapping; the JSON views follow as you type.
