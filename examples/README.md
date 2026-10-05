# Examples

## `seed/`: the metamodels and projects that ship with the repository

Used by the tests, the playground (it is its starting workspace) and the plain example.

```
seed/
  grammars/
    common.langium         shared terminals and data types (a library: no entry rule)
    datamodel.*            entities with property and relationship fields
    mapviewer.*            maps, layers and styles; a GeoJSON layer shows a data-model entity
    sensors.*              the product and its sensors; needs datamodel and mapviewer
    app.langium            a composite: data-model and map-viewer definitions in one document
  projects/
    <project>/
      project.json         { "metamodels": [...] }
      <metamodel>.instance the instance of that metamodel (one per metamodel)
  expected/
    sensors_gresint.json   the JSON the gresint project must produce
```

Next to each grammar, `<name>.constraints.js` holds its extra validation and `<name>.spec.js` its [JSON mapping](../docs/json-spec.md). `common` and `app` have neither.

### The metamodels

| Metamodel | Describes | JSON it owns |
|---|---|---|
| `datamodel` | entities with property fields (`Long autoinc required pk unique`) and relationship fields (`inverse`, `owner`, `multiple`) | `data.dataModel` |
| `mapviewer` | maps (label, centre, layers in order), tile and GeoJSON layers, plain and interval styles | `data.mapViewer` |
| `sensors` | the product (name, SRID, index, languages, package, database, features) and the sensors with their fact table, default map and layer, measurements, dimensions and groups | `features`, `data.basicData`, `data.dataWarehouse`, and the empty `forms`, `lists`, `menus`, `statics` |

`sensors` is modeled on the sensor DSL ([`@lbdudc/sensor-dsl`](https://www.npmjs.com/package/@lbdudc/sensor-dsl)) and on the JSON it produces for the product line. It **needs both other metamodels**: a sensor's `entity` and `factTable` are data-model entities, and its `map` and `layer` are map-viewer ones. Constraints verify what only the combination can say: every measurement is a property of the fact table with the same type, the fact table points at the sensor entity, the layer shows that entity, a bidirectional relationship has an owner on exactly one side, and a layer draws an existing geometry field.

### The projects

| Project | Metamodels | |
|---|---|---|
| `shop` | datamodel | a small data model |
| `city` | datamodel, mapviewer | roads and parcels, shown on a map |
| `composite` | app, datamodel, mapviewer | one document that mixes both, through the `app` metamodel |
| `gresint` | datamodel, mapviewer, sensors | a complete product; its three JSON pieces, merged, are **exactly** `expected/sensors_gresint.json` |
| `map-only`, `sensors-only` | | fixtures with `"playground": false`: combinations the composer rejects, used by the tests and hidden in the playground |

`project.json` fields: `metamodels` (the selection) and, optionally, `"playground": false` to keep a project out of the playground's examples.

### Adding an example

Put the grammar (and optional constraints and mapping) in `grammars/`, a folder with a `project.json` and one `<metamodel>.instance` per metamodel in `projects/`. The playground picks them up at the next build, and `test-support/seed.ts` loads them for the tests.

## `plain/`: the library without a bundler

`plain/index.html` is one page, with no bundler and no framework: two script imports, one worker and a custom element. It shows the same instance as text, form and diagram, keeps them in sync, and has a *Build model* button.

```bash
npm run build:libs    # builds the self-contained bundles the page imports
npm run example       # serves the repository on http://localhost:8099
```

Open <http://localhost:8099/examples/plain/>. The page loads Monaco from `node_modules` (its AMD build) through `plain/monaco-worker.js`; `serve.mjs` is a minimal static server with explicit MIME types, because some Windows setups serve `.js` as `text/plain`, which browsers refuse for module scripts.
