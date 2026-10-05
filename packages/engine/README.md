# @bango/engine

Parses, validates, edits and builds the **instances** of a composition: one per metamodel, in one shared index, so references can cross metamodels. Runs in the page or in a web worker, with the same async API.

```ts
import { Bango } from '@bango/engine';          // composer + engine behind one object

const bango = new Bango();
await bango.setGrammar('datamodel', datamodelGrammar);
await bango.setGrammar('gismodel', gismodelGrammar);
await bango.compose(['datamodel', 'gismodel']);

const state = await bango.setText('gismodel', 'gismodel\ngeojsonlayer roads entity Nope ...');
state.problems;    // [{ severity: 'error', message: "Could not resolve reference to Entity named 'Nope'.", ... }]
```

`langium` is a **peer dependency**. [`@bango/composer`](../composer/README.md) is a dependency, and `comlink` is used by the worker entry only.

## Entry points

| Import | |
|---|---|
| `@bango/engine` | `Bango`, `ModelEngine`, and the types |
| `@bango/engine/worker` | `serveBango()` (inside a worker); the page side, `connectBango(worker)`, is in [`@bango/core/client`](../core/README.md) |
| `@bango/engine/bundle` | a self-contained ES module (Langium and Comlink inlined) for pages without a bundler |
| `@bango/engine/bundle/worker` | the matching worker script |

## `Bango` and `ModelEngine`

`ModelEngine` owns the instances of a `Composition`. `Bango` is a `ModelComposer` and a `ModelEngine` behind one object, which is what you want unless you build compositions yourself. Both implement `EngineApi`; `Bango` adds the composer's operations (`BangoApi`).

### Composing (`Bango`)

| Method | |
|---|---|
| `setGrammar(name, text)`, `removeGrammar(name)` | metamodels |
| `setConstraints(metamodel, code)`, `setSpec(metamodel, code)` | validation rules and JSON mapping |
| `compose(selection?): Promise<CompositionInfo>` | compose and load into the engine. Instance texts are kept and revalidated |
| `listMetamodels(): Promise<GrammarInfo[]>` | every grammar, with its description and requirements |
| `checkSelection(selection): Promise<SelectionCheck>` | can this be a project? Does not touch the loaded instances |
| `bundleText(metamodel)` | the composed, self-contained grammar of one metamodel |
| `getTypings(grammar)` | TypeScript declarations for the constraints and JSON mapping of a grammar, from its AST types |
| `runCases(metamodel, cases)` | check sample instances against what they must report: tests for a grammar and its constraints ([format](../../docs/writing-metamodels.md#5-testing-a-metamodel)). Runs in an engine of its own |
| `getGrammarAst(name)` | the AST of a grammar |

Composer operations run one at a time, in call order, so overlapping `compose` calls cannot apply out of order.

### Instances (`EngineApi`)

Instances are keyed by **metamodel name**. A project has at most one per metamodel.

| Method | |
|---|---|
| `setText(metamodel, text): Promise<InstanceState>` | set or replace the instance; parses, links and validates everything |
| `setInstances(texts)` | replace all instances at once (opening a project): one rebuild |
| `createInstance(metamodel)` | start from the smallest valid root, e.g. `datamodel`; returns the existing one if there is one |
| `removeInstance(metamodel)` | |
| `getInstance(metamodel)`, `getInstances()` | `InstanceState`: `{ metamodel, text, ast?, problems, stale, available }` |
| `getComposition()` | the loaded `CompositionInfo` |

`available` is `false` when the metamodel is not usable (not in the project, a missing requirement, grammar errors); `problems` then holds the reason and `ast` is absent. `stale` means the metamodel's grammar currently has errors and its last good version is being used.

### Editing

```ts
await bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' });
await bango.applyEdit('datamodel', { kind: 'set', path: [{ feature: 'entities', index: 0 }], feature: 'name', value: 'Road' });
await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }] });
```

| `EditOp` | |
|---|---|
| `{ kind: 'set', path, feature, index?, value }` | change a value, a reference, a flag, or one item of a list |
| `{ kind: 'add', path, feature, type?, value? }` | add a child node (`type`) or a list item (`value`) |
| `{ kind: 'remove', path, feature?, index? }` | remove a node, or one item of a list feature |

`path` is a list of `{ feature, index? }` steps down from the root. Changing a value replaces just that token in the text (comments and layout survive); structural changes reprint only the affected node from its grammar rule. The result is the new `InstanceState`; the engine throws if the path is stale (`The document changed, reload the form`) or the edit is impossible (removing the root).

For building forms: `getFormSchema(metamodel)` describes every node type of a grammar (`{ root, types: { Type: { fields: [...] } } }`, each field a `text`, `number`, `boolean`, `enum`, `ref` or `child` with `many` and `required`), and `getRefCandidates(refType)` lists every node a reference of that type could point to, across metamodels.

### Editor support

`complete(metamodel, text, line, column)`, `hover(...)` and `definition(...)` wrap Langium's providers and return plain data. They carry the **editor's live text, which the engine adopts as the instance text first**, so an editor and the engine never disagree. For a metamodel that is not available they return nothing instead of failing. Lines and columns are 0-based.

### JSON

| Method | |
|---|---|
| `toJson(metamodel, options?)` | the instance as JSON: its metamodel's mapping, or the generic tree |
| `toProjectJson(options?)` | the whole project: mappings merged into one document, or one entry per metamodel |

`options` is `{ format?: 'spec' \| 'generic', merge?, refs?, types?, ranges? }`. Everything about it is in [The JSON specification](../../docs/json-spec.md). `mergeJson(...docs)` and `toJsonSpec(ast, options)` are exported too (they live in `@bango/core`).

### Building

```ts
const result = await bango.build('gresint');
result.ok;            // true only if every requirement is met, every instance belongs to the project and validates
result.errors;        // otherwise, why: "gismodel 3:22 Could not resolve reference ...", "'sensors' needs 'datamodel': ..."
result.warnings;      // constraint warnings, which do not block
result.model;         // { project, metamodels, instances: [{ metamodel, extension, ast, spec }], spec }
```

`model.spec` is the merged JSON specification; each instance's `spec` is its own piece.

### Events

```ts
const off = await bango.subscribe(event => { /* ... */ });
```

| Event | |
|---|---|
| `{ type: 'composition' }` | the set of languages changed |
| `{ type: 'instances' }` | the whole set of instances was replaced |
| `{ type: 'instance', metamodel }` | one instance was edited |

Every instance is relinked on each change, so **any** instance may have new problems after any event: re-read what you show. A throwing listener never breaks the engine. `subscribe` returns an unsubscribe function (a promise of one over a worker).

### Serialization

Calls are serialized: each public method runs after the previous one has finished, so you can fire edits without coordinating them.

## In a worker

```ts
// engine.worker.ts
import { serveBango } from '@bango/engine/worker';
serveBango();
```

```ts
// in the page
import { connectBango } from '@bango/core/client';

const bango = connectBango(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }));
await bango.compose([...]);          // same API as a local Bango
bango.disconnect();                  // stop talking to it (does not terminate the worker)
```

The composer and the engine run together inside the worker; only plain data crosses. See [Architecture](../../docs/architecture.md#worker-boundary).

## Without a bundler

```html
<script type="module">
  import { connectBango } from './client.js';       // @bango/core/bundle/client (no Langium)
  const bango = connectBango(new Worker('./bango.worker.js', { type: 'module' }));  // @bango/engine/bundle/worker
</script>
```

[`examples/plain`](../../examples/plain/index.html) is a complete page.

## Source layout

```
src/core/     ModelEngine (the façade) over InstanceStore (texts, documents, state), json-views, serial-queue, event-bus; languages, editor features, build
src/facade/   Bango
src/editing/  form schema, printer, text edits
src/worker/   serveBango
src/bundle/   entries of the self-contained browser build
```
