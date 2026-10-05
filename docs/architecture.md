# Architecture

Bango has two levels, and three modules that connect them, on top of one small package of shared data.

- **Metamodels**: what can be said. A metamodel is a [Langium](https://langium.org) grammar: `datamodel` says what an entity is, `gismodel` what a layer is. Metamodels can refer to each other: a map layer must show a data-model entity.
- **Instances**: what is said. A project chooses metamodels and holds one instance (a text) of each. Instances are checked against their metamodel *and against each other*.

```
 grammars  ─▶  @bango/composer  ─▶  Composition  ─▶  @bango/engine  ─▶  InstanceState  ─▶  @bango/renderer
 (Langium)       compose()          languages,        setText()          text, AST,          text · form
 constraints                        requirements,     applyEdit()        problems,           diagram · AST
 JSON mappings                      stale grammars    build()            JSON                json
                                                      toJson()
```

## The three modules (and `core`)

| | Knows about | Does not know about |
|---|---|---|
| **core** | plain data: DTOs, the JSON spec helpers, the worker client | Langium, grammars, the DOM |
| **composer** | grammars, imports, constraints, JSON mappings | instances, editors, the DOM |
| **engine** | one `Composition`; instance texts; Langium documents | how anything is drawn |
| **renderer** | the engine's *plain-data* API | Langium (it never imports it) |

Everything depends on `core`; beyond that each only depends on the one before it. The renderer depends on `core` **as types only**, so it works unchanged against an engine in the same page or one in a web worker, and a page that only talks to a worker loads no Langium.

### Composer: from grammars to languages

`ModelComposer` holds the grammars of a workspace. `compose(selection)` turns a selection of metamodels into a `Composition`:

1. **Imports are inlined.** Langium's parser builder only looks at a grammar's own rules, so each metamodel is flattened together with everything it imports (what `langium generate` does at build time). Imported entry rules are dropped: a language has one entry.
2. **Requirements come from imports.** A metamodel *requires* every metamodel it imports, directly or not. A selection that leaves one out is not valid, and the composition says which metamodel is missing and what to add.
3. **Only the selection becomes languages.** Metamodels outside the project do not exist for it.
4. **Broken grammars degrade, they do not disappear.** If a grammar has errors, the last version that compiled keeps serving, and its instances are marked `stale`.
5. **Clashing type names are renamed** (see below), in a copy of the grammars made for the selection.
6. **User code is compiled once.** Constraints (`<metamodel>.constraints.js`) and JSON mappings (`<metamodel>.spec.js`) are compiled here; a syntax error is reported as a problem of the metamodel.

`ModelComposer.check(selection)` answers "can this be a project?" without loading anything, which is what a *New project* form needs.

### Engine: one shared index

`ModelEngine.use(composition)` creates **one Langium container** for all languages of the composition: one set of documents, one index, one merged type reflection. This is what makes cross-metamodel references work with no special code: Langium's default scope provider resolves `[Entity:ID]` against everything of type `Entity` in the shared index, and the `Entity` nodes come from the `.datamodel` instance.

The engine keeps **one document per metamodel**, named `memory:/<metamodel>.<extension>`. Every change re-creates all instance documents so each one is re-linked against fresh content; instances are small, and it keeps relinking trivially correct.

Things worth knowing:

- **Calls are serialized.** Every public method runs after the previous one finished. Langium's document builder cannot run two rebuilds of one index at once, and callers (an editor firing as you type, a form, a build) should not have to coordinate.
- **The text is the source of truth.** Forms and diagrams never hold state. An edit is an `EditOp` that becomes a new text: changing a value is a surgical replacement (comments and layout survive), structural changes reprint only the affected node from its grammar rule.
- **Editor requests adopt the live text.** `complete`, `hover` and `definition` carry the editor's current text, and the engine takes it as the instance text first, so an editor and the engine never disagree.
- **Events.** `composition` (the languages changed), `instances` (the whole set was replaced) and `instance` (one was edited). Because every instance is relinked on each change, any instance may have new problems after any event; renderers re-read what they show.

### Renderer: views over plain data

A renderer is a small object (`mount`, `update`, `reveal`, `dispose`) that reads `InstanceState` and writes through `engine.setText` / `engine.applyEdit`. `ModelRenderer` mounts one in an element, keeps it in sync with the engine's events, and lets you switch views without losing the instance. Views are plain DOM; the React app in `apps/playground` only owns the lifecycle.

## Worker boundary

Langium is heavy, so it can run off the UI thread. Langium objects cannot cross a worker boundary, so the **composer and the engine run together** in the worker (`Bango` is the pair behind one object) and everything that crosses is plain data: `CompositionInfo`, `InstanceState`, `AstDto`, JSON. `serveBango()` (`@bango/engine/worker`, runs in the worker) exposes a `Bango`; `connectBango(worker)` (`@bango/core/client`, runs in the page) returns an object with the same async API. The engine's methods are all async for exactly this reason, so a renderer cannot tell the two apart.

### When a script never finishes

Constraints, JSON mappings and import mappings are user code, and code can loop. In a worker that would freeze the engine for good, so `connectBango` takes **a function that makes the worker** and watches it: if no call finishes for `timeoutMs` (10 s) while one is waiting, it

1. rejects the calls in flight (`ScriptTimeoutError` for the oldest, `EngineRestartedError` for the others, once the new engine is ready),
2. terminates the worker and starts a new one,
3. puts back what it knows, *without any script*: the grammars, the last composition, the instance texts, the subscriptions (what is lost: the undo history),
4. switches the scripts on again **one at a time**, each followed by a short check (compose, set the instances, export, import); the one after which the engine stops answering again is **quarantined**, and everything else is back.

`onRestart` and `quarantined()` say what happened; `WorkspaceController` exposes it as `state.quarantined`, re-reads the project from the new engine, and takes a script off the list when it is edited (or switched back on with `reenableScript`). The playground shows a banner. A connection made from the worker itself, and an in-process `Bango`, have no watchdog: synchronous code cannot be interrupted from the same thread, so use a worker in anything that runs other people's metamodels.

## Cost, and limits

Every change to an instance remakes only the documents it can have reached: the changed one, and the metamodels that **need** it (`requires`, which already holds everything a grammar imports, directly or not). A document of any other metamodel cannot refer to what changed, so it keeps its links and its diagnostics. Replacing the composition, or all instances at once, starts from nothing. The same text again costs nothing. (Numbers: [How Bango is tested](testing.md#what-it-costs).)

Limits keep pathological input from becoming a hang: an instance over `maxInstanceChars` (default 2 million) or a grammar over `maxGrammarChars` (1 million) is kept but **not read**, and reported as a problem with the size and the limit; a text nested so deeply that the parser runs out of stack is a problem of that instance (`could not be read: it is nested too deeply`), not a failed call. What no limit can catch (a regular expression that backtracks forever, a script in a loop) is what the [watchdog](#when-a-script-never-finishes) is for.

## Decisions and trade-offs

- **Langium is a peer dependency**, not bundled: Langium's AST types and `instanceof` checks break with two copies. (The self-contained browser builds inline it, because there it is the only copy.)
- **Type names are global, so the composer makes them unique.** All metamodels of a project share one index and one merged reflection keyed by type name; two grammars declaring the same name would mix scopes and overwrite each other's properties. The composer renames the clashing declarations (`Entity` of `other` becomes `OtherEntity`) in a copy of the grammars made for that selection, rewriting the declaration and every reference, and translates constraint keys. The user's grammar text, instance text and error positions are untouched.
- **Grammars are interpreted, not generated.** The playground builds parsers at runtime from the grammar (`interpretAstReflection` and a runtime parser), so no code generation step is needed; the price is slower start-up than generated parsers.
- **Identifiers may contain hyphens** in the shared `common` grammar, because the example data uses names like `stationobservation-layer`. A hyphen inside a name is part of it; negative numbers are unaffected because they start with `-`.
- **Diagram without a framework.** The diagram is plain SVG with [elkjs](https://github.com/kieler/elkjs) for layout (loaded lazily; a built-in layered layout is the fallback), so it works in any page.

## Source layout

```
packages/core/src/       types.ts   plain data types     json.ts   JSON spec and merging
                         client.ts  connectBango         bundle/   self-contained client (no Langium)
packages/composer/src/   compose/   ModelComposer, Composition
                         grammar/   import inlining, merged reflection, self-contained grammar text
                         scripts/   compiles the user's constraints and JSON mappings (compose/ binds them to a selection)
                         model/     Langium-bound types, AST -> plain tree, problems
packages/engine/src/     core/      ModelEngine over InstanceStore, json-views, serial-queue, event-bus; languages, features, build
                         facade/    Bango: composer + engine behind one API
                         editing/   form schema, printer, text edits
                         worker/    serveBango                     bundle/   self-contained browser build
packages/renderer/src/   host/      ModelRenderer, view registry, <bango-instance>
                         views/     text (Monaco), form, diagram, ast, json
                         dom/       DOM helpers and the default stylesheet      bundle/   self-contained browser build
```
