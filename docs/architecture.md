# Architecture

Bango has two levels, and three modules that connect them.

- **Metamodels**: what can be said. A metamodel is a [Langium](https://langium.org) grammar: `datamodel` says what an entity is, `mapviewer` what a layer is. Metamodels can refer to each other: a map layer must show a data-model entity.
- **Instances**: what is said. A project chooses metamodels and holds one instance (a text) of each. Instances are checked against their metamodel *and against each other*.

```
 grammars  ─▶  @bango/composer  ─▶  Composition  ─▶  @bango/engine  ─▶  InstanceState  ─▶  @bango/renderer
 (Langium)       compose()          languages,        setText()          text, AST,          text · form
 constraints                        requirements,     applyEdit()        problems,           diagram · AST
 JSON mappings                      stale grammars    build()            JSON                json
                                                      toJson()
```

## The three modules

| | Knows about | Does not know about |
|---|---|---|
| **composer** | grammars, imports, constraints, JSON mappings | instances, editors, the DOM |
| **engine** | one `Composition`; instance texts; Langium documents | how anything is drawn |
| **renderer** | the engine's *plain-data* API | Langium (it never imports it) |

Each only depends on the one before it. The renderer depends on the engine **as types only**, so it works unchanged against an engine in the same page or one in a web worker.

### Composer: from grammars to languages

`ModelComposer` holds the grammars of a workspace. `compose(selection)` turns a selection of metamodels into a `Composition`:

1. **Imports are inlined.** Langium's parser builder only looks at a grammar's own rules, so each metamodel is flattened together with everything it imports (what `langium generate` does at build time). Imported entry rules are dropped: a language has one entry.
2. **Requirements come from imports.** A metamodel *requires* every metamodel it imports, directly or not. A selection that leaves one out is not valid, and the composition says which metamodel is missing and what to add.
3. **Only the selection becomes languages.** Metamodels outside the project do not exist for it.
4. **Broken grammars degrade, they do not disappear.** If a grammar has errors, the last version that compiled keeps serving, and its instances are marked `stale`.
5. **User code is compiled once.** Constraints (`<metamodel>.constraints.js`) and JSON mappings (`<metamodel>.spec.js`) are compiled here; a syntax error is reported as a problem of the metamodel.

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

Langium is heavy, so it can run off the UI thread. Langium objects cannot cross a worker boundary, so the **composer and the engine run together** in the worker (`Bango` is the pair behind one object) and everything that crosses is plain data: `CompositionInfo`, `InstanceState`, `AstDto`, JSON. `serveBango()` exposes a `Bango` from a worker; `connectBango(worker)` returns an object with the same async API. The engine's methods are all async for exactly this reason, so a renderer cannot tell the two apart.

## Decisions and trade-offs

- **Langium is a peer dependency**, not bundled: Langium's AST types and `instanceof` checks break with two copies. (The self-contained browser builds inline it, because there it is the only copy.)
- **Rule names are global.** All metamodels share one index, so two grammars declaring the same rule name would mix their scopes. The composer warns when it sees one.
- **Grammars are interpreted, not generated.** The playground builds parsers at runtime from the grammar (`interpretAstReflection` and a runtime parser), so no code generation step is needed; the price is slower start-up than generated parsers.
- **Identifiers may contain hyphens** in the shared `common` grammar, because the example data uses names like `stationobservation-layer`. A hyphen inside a name is part of it; negative numbers are unaffected because they start with `-`.
- **Diagram without a framework.** The diagram is plain SVG with [elkjs](https://github.com/kieler/elkjs) for layout (loaded lazily; a built-in layered layout is the fallback), so it works in any page.

## Source layout

```
packages/composer/src/   compose/   ModelComposer, Composition
                         grammar/   import inlining, merged reflection, self-contained grammar text
                         scripts/   compiles the user's constraints and JSON mappings
                         model/     shared types, AST -> plain tree, problems
packages/engine/src/     core/      ModelEngine: documents, languages, editor features, build
                         facade/    Bango: composer + engine behind one API
                         forms/     form schema, printer, text edits
                         json/      JSON spec and merging
                         worker/    serveBango / connectBango      bundle/   self-contained browser build
packages/renderer/src/   host/      ModelRenderer, view registry, <bango-instance>
                         views/     text (Monaco), form, diagram, ast, json
                         dom/       DOM helpers and the default stylesheet      bundle/   self-contained browser build
```
