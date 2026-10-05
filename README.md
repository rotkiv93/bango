# Bango

Define **metamodels** as [Langium](https://langium.org) grammars, **compose** them into projects, and edit the **instances** as text, forms or diagrams. Metamodels can reference each other (a map layer must show a data-model entity), and everything is checked together: a project that picks a metamodel without what it needs is rejected, a reference to something that does not exist is an error, and so is a layer that shows the wrong entity.

An instance turns into JSON, and the pieces of all the metamodels of a project merge into one specification.

**Try it:** the [playground](apps/playground/README.md) runs entirely in the browser, and deploys as a static site ([guide](docs/deploy-github-pages.md)).

```bash
npm install
npm run dev        # the playground
npm test           # 250+ tests: composer, engine (also across a worker boundary), renderers
```

## In code

```ts
import { Bango } from '@bango/engine';
import { ModelRenderer } from '@bango/renderer';

const bango = new Bango();
await bango.setGrammar('datamodel', datamodelGrammar);
await bango.setGrammar('gismodel', gismodelGrammar);           // `import 'datamodel'` inside it

(await bango.checkSelection(['gismodel'])).errors;
// ["'gismodel' needs 'datamodel': add 'datamodel' to this project"]

await bango.compose(['datamodel', 'gismodel']);
await bango.setText('datamodel', 'datamodel shop\nentity Road { property geometry: LineString }');
await bango.setText('gismodel', 'gismodel\ngeojsonlayer roads entity Road defaultStyle s availableStyles s ...');

const view = new ModelRenderer(bango);
await view.mount(document.querySelector('#editor')!, 'datamodel', 'form');   // or 'text', 'diagram', 'json', 'ast'

await bango.build('shop');         // the final model, or the reasons it cannot be built
await bango.toProjectJson();       // the project's JSON specification
```

## The modules

| Package | Role |
|---|---|
| [`@bango/core`](packages/core/README.md) | the plain data types, the JSON helpers and the worker client that every other package shares; no Langium |
| [`@bango/composer`](packages/composer/README.md) | composes grammars into languages; checks that a selection fits together; compiles constraints and JSON mappings |
| [`@bango/engine`](packages/engine/README.md) | parses, validates and edits **one instance per metamodel**; builds the final model; JSON; runs in the page or in a worker. Its `workspace` entry (no Langium) holds projects, scripts, saving: everything an editor needs that is not drawing |
| [`@bango/renderer`](packages/renderer/README.md) | framework-agnostic views: text (Monaco), form, diagram, AST, JSON; a custom element |

```
grammars ──▶ composer ──▶ Composition ──▶ engine ──▶ InstanceState ──▶ renderer
 (Langium)   compose()     languages,      setText()    text, AST,       text · form
                           requirements    build()      problems, JSON   diagram · ast · json
```

Each module only depends on the one before it, and the renderer only on the plain data types of `@bango/core`, so views work the same against an engine in the page or in a worker. A page that only talks to a worker (`connectBango` from `@bango/core/client`) never loads Langium.

## Documentation

| | |
|---|---|
| [Architecture](docs/architecture.md) | how the modules fit together, and why |
| [Writing metamodels](docs/writing-metamodels.md) | grammar, constraints and JSON mapping |
| [The JSON specification](docs/json-spec.md) | mapping, merging, the generic format, options |
| [Deploying to GitHub Pages](docs/deploy-github-pages.md) | publishing the playground |
| [The playground](apps/playground/README.md) | the app: pages, how it uses the library |
| [The examples](examples/README.md) | the shipped metamodels (basic, data model, GIS model, sensors, forms, lists) and projects, and a page without a bundler |

## Repository layout

```
packages/composer, engine, renderer   the library (each with its own README)
apps/playground                       the web app
examples/seed                         metamodels and projects that ship (tests, playground, plain example)
examples/plain                        the library without a bundler
docs                                  documentation, and the diagrams the first metamodels came from
test-support                          helpers shared by the tests
.github/workflows/pages.yml           tests, and publishes the playground to GitHub Pages
```

## Develop

```bash
npm test                # all tests (vitest)
npm run typecheck       # every package
npm run build:libs      # packages into dist/ (ESM, .d.ts, and self-contained browser bundles)
npm run pages           # the playground as a static site, in apps/playground/dist
npm run example         # serve examples/plain on http://localhost:8099
```

Requires Node 22. The packages are consumed from source during development and tests (aliases in `vite.config.ts` and `tsconfig.base.json`); their `exports` point to `dist/` for published builds.
