# @lbdudc/bango

Define **metamodels** as [Langium](https://langium.org) grammars, **compose** them into projects, and edit the **instances** as text, forms or diagrams. Metamodels can reference each other, and everything is checked together.

```bash
npm install @lbdudc/bango langium
```

`langium` is a peer dependency (the engine and the composer use it); `comlink` comes with the package.

```ts
import { Bango } from '@lbdudc/bango';

const bango = new Bango();
await bango.setGrammar('datamodel', datamodelGrammar);
await bango.setGrammar('gismodel', gismodelGrammar);
await bango.compose(['datamodel', 'gismodel']);

const state = await bango.setText('gismodel', 'gismodel\ngeojsonlayer roads entity Nope ...');
state.problems;   // [{ severity: 'error', message: "Could not resolve reference to Entity named 'Nope'.", ... }]
```

## Entry points

One package, one import path per part:

| Import | What it is |
|---|---|
| `@lbdudc/bango` | `Bango`, `ModelEngine` and their types (the composer and the engine behind one object) |
| `@lbdudc/bango/core` | the shared types, the JSON mapping (`toJsonSpec`), helpers. No Langium |
| `@lbdudc/bango/core/client` | `connectBango(worker)`: the page side of a Bango that runs in a web worker |
| `@lbdudc/bango/composer` | `ModelComposer`: grammars and constraints into a composition |
| `@lbdudc/bango/engine/workspace` | `WorkspaceController` and what it keeps: projects, metamodels, scripts, test cases, saving |
| `@lbdudc/bango/engine/worker` | `serveBango()`, to run in the worker |
| `@lbdudc/bango/renderer` | the views of an instance (forms, diagrams, text) and the visualizations. Needs a DOM |
| `@lbdudc/bango/renderer/text` | the text view (Monaco) |
| `@lbdudc/bango/studio` | the editing panels |
| `@lbdudc/bango/*/bundle` | self-contained ES modules for pages without a bundler: `core/bundle/client`, `engine/bundle`, `engine/bundle/worker`, `renderer/bundle`, `studio/bundle` |

The same code runs in the page or in a worker with the same async API; see the [repository](https://gitlab.lbd.udc.es/linea/bango) for the playground, the examples and the guides.

## Publishing

From the repository: `npm run verify` (builds the libraries and this package, then installs the tarball alone into an empty project and uses it), then `npm publish -w @lbdudc/bango --access public`.
