# Embedding bango in an application

bango is a set of libraries, not an application: an application brings its own storage, its own users and its own idea of where metamodels come from (a git host, a database, a folder). What it takes to put bango in one:

| You want | Use | It needs from the page |
|---|---|---|
| to **edit the instances** of a project (text, form, diagram, JSON) | `@bango/renderer` (`ModelRenderer`, or `<bango-instance>`) over an engine | an engine (`connectBango` to a worker), Monaco for the text view, and the metamodels loaded into the engine |
| to **write a metamodel** (grammar, scripts, tests, preview) | `@bango/studio` (`MetamodelStudio`) | an engine **of its own**, Monaco, the renderer library, the files of the metamodel and of what it imports |

Neither knows where metamodels come from: they are pushed in (`setGrammar`, `setConstraints`, `setSpec`, `setImport`, `setScope`). There is no registry in bango. An application that has one (LINEA reads its metamodels and modules from git repositories, through a catalog) fetches the files and hands them over; the studio hands back what changed, and the application saves it.

## Without a bundler

`@bango/core/bundle/client`, `@bango/engine/bundle/worker`, `@bango/renderer/bundle` and `@bango/studio/bundle` are self-contained ES modules. Serve them as static files and load them with a native `import()`:

```js
const [{ connectBango }, renderer, { MetamodelStudio }] = await Promise.all([
  import('/bango/client.js'), import('/bango/renderer.js'), import('/bango/studio.js')
]);
renderer.registerTextRenderer(monaco, { theme: 'vs-dark' });
const studio = new MetamodelStudio({ bango: connectBango(() => new Worker('/bango/bango.worker.js', { type: 'module' })), monaco, renderer, metamodel, files, dependencies });
await studio.mount(el);
```

The studio is given the renderer **namespace** (`renderer`) instead of importing it, so the views registered on the page's copy (`registerTextRenderer`) are the ones the preview shows, and nothing is loaded twice. LINEA does exactly this in `client/src/components/modules/MetamodelStudio.vue`.

## Views a metamodel brings

A metamodel may ship `<name>.visualizations.js`: views of its instances that only it knows how to draw (see the [renderer](../packages/renderer/README.md#visualizations-views-a-metamodel-brings)). They are page code, so they do not go to the engine: the application reads the file with the rest of the metamodel and gives it to the renderer.

```ts
const visualizations = new VisualizationStore();
for (const [metamodel, code] of Object.entries(visualizationFiles)) visualizations.set(metamodel, code);
const layouts = new MemoryLayoutStore();
layouts.load(savedLayouts);                       // where the nodes were left, saved by you
layouts.subscribe(() => markAsChanged());         // a node moved: save layouts.toJSON() with the model
const view = new ModelRenderer(bango, { visualizations, layouts });
view.views('datamodel');                          // the tabs to offer, built-in and brought
```

Where the file comes from and where the layout is kept is the application's business (LINEA reads the file from the metamodel's repository, and keeps `models/<metamodel>.layout.json` in the product's); bango only runs one and asks for the other. The studio has a *Visualizations* tab, and its preview offers whatever is typed there.

## Two engines

The engine holds **one composition**: `compose(selection)` replaces it. The editor of a product's models (`ModelRenderer` over the product's metamodels) and the studio (which composes the metamodel it edits with what it needs) must therefore not share an engine. Start one worker for each; they are independent.

## Script intelligence

The script editors (constraints, scope, JSON mapping, JSON import) are plain until the page gives the studio Monaco's TypeScript service (`typescript: async () => monaco.languages.typescript`, or an `import('monaco-editor/.../typescript/monaco.contribution')`). Then they know the AST types of the grammar. It brings a worker of several MB, which the page must be able to serve (with Vite, `vite-plugin-monaco-editor` or `?worker` imports); nothing loads until a script editor is first opened.

## The playground

The [playground](../apps/playground) edits the project's metamodels against the engine that holds the open project, so that every edit revalidates the instances: it does not use the studio.
