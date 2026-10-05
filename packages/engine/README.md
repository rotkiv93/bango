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
| `@bango/engine/workspace` | `WorkspaceController` and the data it keeps: projects, metamodels, scripts, test cases, saving. No Langium |
| `@bango/engine/worker` | `serveBango()` (inside a worker); the page side, `connectBango(worker)`, is in [`@bango/core/client`](../core/README.md) |
| `@bango/engine/bundle` | a self-contained ES module (Langium and Comlink inlined) for pages without a bundler |
| `@bango/engine/bundle/worker` | the matching worker script |

## `Bango` and `ModelEngine`

`ModelEngine` owns the instances of a `Composition`. `Bango` is a `ModelComposer` and a `ModelEngine` behind one object, which is what you want unless you build compositions yourself. Both implement `EngineApi`; `Bango` adds the composer's operations (`BangoApi`).

### Composing (`Bango`)

| Method | |
|---|---|
| `setGrammar(name, text)`, `removeGrammar(name)` | metamodels |
| `setConstraints(metamodel, code)`, `setSpec(metamodel, code)`, `setImport(metamodel, code)` | validation rules, JSON mapping, and its inverse |
| `compose(selection?): Promise<CompositionInfo>` | compose and load into the engine. Instance texts are kept and revalidated |
| `listMetamodels(): Promise<GrammarInfo[]>` | every grammar, with its description and requirements |
| `checkSelection(selection): Promise<SelectionCheck>` | can this be a project? Does not touch the loaded instances |
| `bundleText(metamodel)` | the composed, self-contained grammar of one metamodel |
| `importJson(json)` | build the instances of the project from the JSON of a whole project, using the import mappings: `{ texts, skipped, errors, problems }`. Changes nothing; `setInstances(texts)` uses the result ([format](../../docs/writing-metamodels.md#4-the-import-mapping-optional)) |
| `getTypings(grammar)` | TypeScript declarations for the constraints and JSON mapping of a grammar, from its AST types |
| `runCases(metamodel, cases)` | check sample instances against what they must report: tests for a grammar and its constraints ([format](../../docs/writing-metamodels.md#5-testing-a-metamodel)). Runs in an engine of its own |
| `getGrammarAst(name)` | the AST of a grammar |

Every call, the composer's and the engine's, runs one at a time and **in the order it was made**, so an app may fire `compose(...)` and then `applyEdit(...)` without waiting for the first and the edit still sees the composition.

### Instances (`EngineApi`)

Instances are keyed by **metamodel name**. A project has at most one per metamodel.

| Method | |
|---|---|
| `setText(metamodel, text): Promise<InstanceState>` | set or replace the instance; parses, links and validates everything |
| `setInstances(texts)` | replace all instances at once (opening a project): one rebuild |
| `createInstance(metamodel)` | start from the smallest valid root, e.g. `datamodel`; returns the existing one if there is one |
| `removeInstance(metamodel)` | |
| `getInstance(metamodel)`, `getInstances()` | `InstanceState`: `{ metamodel, text, ast?, problems, stale, available, canUndo?, canRedo? }` |
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

`path` is a list of `{ feature, index? }` steps down from the root. Changing a value replaces just that token in the text (comments and layout survive); structural changes reprint only the affected node from its grammar rule. The result is the new `InstanceState`; the engine throws if the path is stale (`The document changed, reload the form`) or the edit is impossible (removing the root). **What the grammar requires cannot be removed**: the last element of a list that must have one (`(fields+=Field)+`) is refused with `'Entity' needs at least one 'fields'`, and nothing changes. Removing the only child of a node takes what surrounds it (`{ }`) with it, and a new node starts from text the grammar accepts.

For building forms: `getFormSchema(metamodel)` describes every node type of a grammar (`{ root, types: { Type: { fields: [...] } } }`, each field a `text`, `number`, `boolean`, `enum`, `ref` or `child` with `many` and `required`; a field whose value is a data type rule also has a `sample` the grammar accepts), and `getRefCandidates(refType)` lists every node a reference of that type could point to, across metamodels.

### Editor support

`complete(metamodel, text, line, column)`, `hover(...)` and `definition(...)` wrap Langium's providers and return plain data. They carry the **editor's live text, which the engine adopts as the instance text first**, so an editor and the engine never disagree. For a metamodel that is not available they return nothing instead of failing. Lines and columns are 0-based.

### Editing across instances

The instances of a project share one index, so these work **across metamodels**: a data-model entity and the GIS layer that shows it are one symbol.

| Method | |
|---|---|
| `references(metamodel, text, line, column)` | every place that refers to the symbol at the position (and its declaration), in every instance: `{ metamodel, range }[]` |
| `rename(metamodel, text, line, column, newName)` | the edits that rename the symbol everywhere: `{ edits, applied, error? }`. The engine changes the **other** instances itself (one rebuild) and lists them in `applied`; the instance that asked is left to its editor, which holds the live text and applies its own `edits`. `error` says why nothing could be renamed |
| `symbols(metamodel, text)` | the outline: named elements, nested, as `{ name, kind, range, selectionRange, children }[]` |
| `quickFixes(metamodel, text, line, column)` | fixes for the problem at the position. For a reference that does not resolve: `Create Entity 'Foo'` **in the metamodel whose instances can hold an entity** (it may be another one than the instance being edited) |
| `applyQuickFix(fix)` | does it, starting that metamodel's instance if the project has none yet. A `QuickFix` is plain data (`{ title, metamodel, type, name }`) |
| `undo(metamodel)`, `redo(metamodel)` | go back or forward one change. Every instance has its own history (100 steps); typing in quick succession is one step; replacing all instances or removing one clears it |

Undo and redo are for the views that have no editor of their own (form, diagram); a text editor keeps its own history too. A rename that reached into another instance is undone there.

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

## Projects and workspaces (`@bango/engine/workspace`)

Everything an editor needs that is not drawing lives here, so an application is only views. It imports **only `@bango/core`** (no Langium), so a page whose engine is in a worker can use it without loading the parser.

```ts
import { WorkspaceController, MemoryStorage, parseSeed, workspaceFromSeed } from '@bango/engine/workspace';
import { connectBango } from '@bango/core/client';

const controller = new WorkspaceController(connectBango(worker), {
  storage,                                            // anything with load() / save(data): IndexedDB, a file, MemoryStorage
  seed: () => workspaceFromSeed(parseSeed(files)),    // the examples of a first visit
});
controller.subscribe(state => render(state));         // state: workspace, activeProject, composition, catalog, instances, build, ...
await controller.init();
await controller.createProject('shop', ['datamodel']); // { ok: true } or { ok: false, errors, suggested }
controller.editGrammar('datamodel', text);              // sent to the engine a moment later, per file
await controller.buildProject();                        // sees every edit made before the call
```

| | |
|---|---|
| `init()`, `reset()` | load the saved workspace (or the examples; workspaces saved by older versions are completed) and bring the engine up to date; back to the examples |
| `createProject(name, selection)`, `openProject`, `deleteProject`, `setProjectMetamodels(selection)` | projects. The composer decides whether the metamodels fit; the answer says why not and what to add. The selection is kept in catalog order |
| `createInstance`, `removeInstance`, `undo`, `redo` | the instances of the open project, mirrored into the saved project |
| `editGrammar(name, text)`, `editScript(kind, metamodel, code)`, `ensureScript(kind, metamodel)`, `addGrammar(name)` | metamodels and their constraints / JSON mapping / import mapping. Edits are **debounced per file**: editing two grammars in quick succession sends both |
| `setCases(metamodel, cases)`, `runCases(metamodel)` | the saved test cases of a metamodel, run against the grammar and scripts as they are now |
| `previewImport(json)`, `applyImport(texts)` | import JSON into the open project; instances of metamodels without an import mapping stay |
| `buildProject()` | the final model of the open project |
| `flush()` | send everything that is waiting now and wait for it. Called before anything that reads the engine; call it in tests |

Also exported: `WorkspaceData` (what is saved), `migrateWorkspace`, `MemoryStorage`, the starting `templates` and `grammarTemplate`, `validateMetamodelName` / `validateProjectName`, `parseSeed` / `workspaceFromSeed` (the layout of a folder of examples), and `KeyedDebouncer`.

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

Give `connectBango` **a function that makes the worker** instead and it also notices an engine that stops answering (a constraint or mapping in an endless loop), replaces it, and switches the culprit script off; see [When a script never finishes](../../docs/architecture.md#when-a-script-never-finishes).

```ts
const bango = connectBango(
  () => new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }),
  { timeoutMs: 10_000, onRestart: ({ call, quarantined }) => warn(call, quarantined) }
);
bango.quarantined();                 // [{ kind: 'constraints', metamodel: 'datamodel' }]
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
src/workspace/ WorkspaceController, saved data, templates, seed layout, name validation (no Langium)
src/worker/   serveBango
src/bundle/   entries of the self-contained browser build
```
