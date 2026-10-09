# Examples

## `seed/`: the metamodels and projects that ship with the repository

Used by the tests, the playground (it is its starting workspace) and the plain example.

The kind folders of `seed/` (`grammars`, `constraints`, `specs`, `imports`, `scopes`, `visualizations`, `cases`) are a **copy** of the LINEA `metamodels` repository (the source of those metamodels). Change them there and run `npm run check:metamodels -- ../metamodels --sync`; without `--sync` (`--seed`) it says whether they are in step, and without either it only checks the folder is well formed.

```
seed/
  grammars/ constraints/ specs/ imports/ scopes/ visualizations/ cases/
                           one folder per kind of file, each file named after its metamodel
                           (grammars/datamodel.langium, constraints/datamodel.js, cases/datamodel.json, ...)
                           metamodels: common (shared terminals and types, a library: no entry rule), basic, datamodel,
                           gismodel, sensors, browser, menus, gui, statics
  projects/
    <project>/
      project.json         { "metamodels": [...] }
      <metamodel>.instance the instance of that metamodel (one per metamodel)
  expected/
    sensors_gresint.json   the JSON the gresint project must produce
```

For each grammar, `constraints/<name>.js` holds its extra validation, `specs/<name>.js` its [JSON mapping](../docs/json-spec.md), `imports/<name>.js` the [inverse of that mapping](../docs/writing-metamodels.md#4-the-import-mapping-optional) (JSON back into its instance) and `cases/<name>.json` its [test cases](../docs/writing-metamodels.md#6-testing-a-metamodel). `common` has none of them.

### The metamodels

| Metamodel | Describes | Needs | JSON it owns |
|---|---|---|---|
| `basic` | the product: name, version, SRID, languages, package, database, deployment settings, feature selection | nothing | `features`, `data.basicData`, and the skeleton of the document |
| `datamodel` | entities with property fields (`Long autoinc required pk unique`) and relationship fields (`inverse`, `owner`, `multiple`) | nothing | `data.dataModel` |
| `gismodel` | maps (label, centre, zoom range, projection, layers in order with their opacity), tile, GeoJSON and WMS layers, plain and interval styles | datamodel | `data.mapViewer` |
| `sensors` | sensors with their fact table, default map and layer, measurements, dimensions and groups | datamodel, gismodel | `data.dataWarehouse` |
| `browser` | the data-entry forms and the lists of the entities, as the platform reads them: what a person can do with each, the fields and columns it shows | datamodel | `data.forms`, `data.lists` |
| `menus` | nested navigation menus (`top`, `left`, `right`) whose items open a screen of the platform or hold more items, with who sees each | nothing | `data.menus` |
| `gui` | the look of the interface: where the menus are (the design), the font and the colours | nothing | `data.gui` |
| `statics` | pages of HTML the product shows as they are | nothing | `data.statics` |

`basic` is the root of the product specification: its mapping lays out the whole document and the others fill it in. `browser` is an optional part of a product, and needs the data model when it is used. A product without a map or sensors has no `data.mapViewer` or `data.dataWarehouse` (an empty `gismodel` instance says so; `declared` says the map configuration is there, empty).

`sensors` is modeled on the sensor DSL ([`@lbdudc/sensor-dsl`](https://www.npmjs.com/package/@lbdudc/sensor-dsl)) and on the JSON it produces for the product line. A sensor's `entity` and `factTable` are data-model entities, and its `map` and `layer` are GIS-model ones. Constraints verify what only the combination can say: every measurement is a property of the fact table with the same type, the fact table points at the sensor entity, the layer shows that entity, a bidirectional relationship has an owner on exactly one side, a layer draws an existing geometry field, and the fields of a form or the columns of a list exist in their entity.

`menus` was added to stress the combination of metamodels:

- **`menus`** has a **recursive** rule (groups hold items), and fills the `data.menus` slot that `basic` leaves empty. A project without it keeps the original document, empty slot included.

`security` is not shipped any more (the platform has no use for it), but the engine's tests keep it as a fixture in `test-support/fixtures`: it reaches the data model along two paths (a *diamond* of imports) and has a reference to a **type that three metamodels contribute to** (`type Resource = Entity | FormDef | ListDef`), which is what made the merged type reflection forget a shared type. The projects built on it (`security-office`, `security-everything`, `security-only`) live there too, hidden in the playground.

The forms, lists, menus and `gui` JSON is the shape the platform's templates read (see the real products in `LINEA/products`): `id`, `entity`, the flags of each form and list, and `properties` with `owner`, `viewing` and `editing`.

### The projects

| Project | Metamodels | |
|---|---|---|
| `shop` | datamodel | a small data model |
| `city` | datamodel, gismodel | roads and parcels, shown on a map |
| `catalog` | datamodel, browser | products and categories, with a form and a list for each |
| `gresint` | basic, datamodel, gismodel, sensors | a complete product; its four JSON pieces, merged, are **exactly** `expected/sensors_gresint.json` |
| `office` | datamodel, browser | customers and invoices |
| `portal` | datamodel, browser, gismodel, menus | roads on a map, with a form, a list and a nested menu that opens them |
| `everything` | all of them | the gresint product with forms, lists, menus, an interface and static pages on top; the part that is gresint's is still exactly `expected/sensors_gresint.json` |
| `gismodel-only`, `sensors-only`, `browser-only`, `menus-only` | | fixtures with `"playground": false`: combinations the composer rejects, used by the tests and hidden in the playground |

`project.json` fields: `metamodels` (the selection) and, optionally, `"playground": false` to keep a project out of the playground's examples.

### Adding an example

Put the grammar in `grammars/` (and the optional constraints, mappings and test cases in their own folders), a folder with a `project.json` and one `<metamodel>.instance` per metamodel in `projects/`. The playground picks them up at the next build, and `parseSeed` in `@bango/engine/workspace` reads the layout, and `test-support/seed.ts` loads them for the tests.

## `plain/`: the library without a bundler

`plain/index.html` is one page, with no bundler and no framework: two script imports, one worker and a custom element. It shows the same instance as text, form and diagram, keeps them in sync, and has a *Build model* button.

```bash
npm run build:libs    # builds the self-contained bundles the page imports
npm run example       # serves the repository on http://localhost:8099
```

Open <http://localhost:8099/examples/plain/>. The page loads Monaco from `node_modules` (its AMD build) through `plain/monaco-worker.js`; `serve.mjs` is a minimal static server with explicit MIME types, because some Windows setups serve `.js` as `text/plain`, which browsers refuse for module scripts.
