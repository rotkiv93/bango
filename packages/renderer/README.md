# @bango/renderer

Views of an instance: **text** (Monaco), **form**, **diagram**, **AST** and **JSON**. Plain DOM, no framework. A view only talks to the [engine's](../engine/README.md) plain-data API, never to Langium, so it works the same against an engine in the page or in a worker.

```ts
import { ModelRenderer } from '@bango/renderer';
import { registerTextRenderer } from '@bango/renderer/text';
import * as monaco from 'monaco-editor/editor/editor.api';

registerTextRenderer(monaco);                       // adds the `text` view; the page owns Monaco

const view = new ModelRenderer(bango);              // bango: a Bango, or connectBango(worker)
await view.mount(document.querySelector('#editor')!, 'datamodel', 'text');
await view.setView('form');                         // same instance, another view
view.dispose();
```

Peer dependencies: `@bango/engine` (types only), and optionally `monaco-editor` (the `text` view) and `elkjs` (diagram layout).

## Views

| View | Shows | Edits through |
|---|---|---|
| `text` | the instance in its own syntax, with highlighting, completion, hover, go-to-definition, find references, rename (F2), outline and quick fixes, **across the instances of the project**, and live problems | `engine.setText` (debounced) |
| `form` | a form generated from the grammar: inputs, drop-downs of references (across metamodels), lists with add and remove | `engine.applyEdit` |
| `diagram` | **the whole project**: named elements as nodes, containment and references as edges, references across metamodels highlighted. Pan, zoom, drag nodes, double-click to fit, click a node to show its text | nothing |
| `ast` | the parsed tree of this instance, with resolved references (unresolved ones in red), or its raw JSON | nothing |
| `project-ast` | the same for every instance of the project | nothing |
| `json` | this instance's JSON: its mapping or the generic tree, with options, copy and download | nothing |
| `project-json` | the project's JSON: merged document or one entry per metamodel | nothing |

Views that point at source (a diagram node, an AST entry) ask the host to show it; by default the same metamodel switches to its text view.

## `ModelRenderer`

```ts
new ModelRenderer(engine: EngineApi, options?: { onReveal?(metamodel, range): void; noStyles?: boolean })
```

| | |
|---|---|
| `mount(el, metamodel, view = 'text')` | show an instance in `el`. Throws if already mounted |
| `setView(view)` | switch views; the instance stays |
| `setMetamodel(metamodel)` | show another metamodel's instance in the same view |
| `reveal(range)` | select and show a source range, switching to the text view if needed |
| `refresh()` | re-read the instance and update the view. Called automatically on engine events |
| `dispose()` | remove the view and stop listening |
| `view`, `metamodel` | the current ones |

`onReveal` replaces the default behaviour when a view asks to show source (open another tab, say). `noStyles` skips the default stylesheet.

## The `text` view and Monaco

The library never imports Monaco: you pass the namespace, so there is exactly one copy and a CDN build works too (`registerTextRenderer(window.monaco)`).

```ts
registerTextRenderer(monaco, { theme: 'vs-dark', fontSize: 13, debounceMs: 250, editorOptions: {} });
```

- **Monaco's own web workers are the page's business** (`MonacoEnvironment.getWorker`).
- **Monaco must include its editor features** (suggest, hover, go-to-definition, rename, reference search, document symbols, code actions). The bare `monaco-editor/editor/editor.api` entry does not; the AMD/CDN build and `monaco-editor/editor/editor.main` do. [`apps/playground/src/monaco-features.ts`](../../apps/playground/src/monaco-features.ts) imports just the features, without the CSS/HTML/JSON/TypeScript language services.
- One Monaco language per metamodel is registered (`bango-<metamodel>`), with a tokenizer built from the grammar's keywords. The tokenizer follows the grammar as it changes.
- Typing is debounced and flushed when the editor loses focus. While typing is pending or in flight, incoming updates do not overwrite it.

`@bango/renderer/text` also exports `CodeEditor`, a Monaco editor bound to one text with debounced `onChange`, problem markers and a `reveal`, which the playground uses for grammar and constraint editing, and `registerCodeLanguages(monaco)` for the `langium` and `bango-js` languages.

## The `diagram` view

Nodes are coloured per metamodel; edges are *contains* (grey), *references* (blue, dashed) and *references across metamodels* (orange, animated). Layout uses [elkjs](https://github.com/kieler/elkjs) when it can be imported and a built-in layered layout otherwise, or your own:

```ts
import { registerRenderer, DiagramRenderer, layeredLayout } from '@bango/renderer';
registerRenderer('diagram', ctx => new DiagramRenderer(ctx, { layout: layeredLayout }));
```

`buildGraph(instances)` returns the nodes and edges if you want to draw them yourself.

## Custom views

A view is an object; register it under a name and use that name as a view:

```ts
import { registerRenderer } from '@bango/renderer';

registerRenderer('size', ctx => {
  let node: HTMLElement;
  return {
    mount: el => { node = document.createElement('p'); el.appendChild(node); },
    update: state => { node.textContent = `${ctx.metamodel}: ${state.text.length} characters`; },
    dispose: () => node.remove()
  };
});

await view.setView('size');
```

`InstanceRenderer` is `{ mount(el), update(state: InstanceState), reveal?(range), dispose() }`. `ctx` gives you `engine`, `metamodel` and `reveal(metamodel, range)`. `update` is called on every engine event, and again after `mount`. Registering a name that exists replaces the built-in view.

## Visualizations: views a metamodel brings

The built-in views know nothing of any metamodel. A metamodel that has something better to show than a form (a class diagram for a data model, a sensor diagram for sensors) brings it itself, in its `visualizations/<name>.js`. bango loads it and offers each visualization as a view named `viz:<id>`; it never knows what they draw.

```js
// visualizations/datamodel.js: the body of a function that returns the list. `kit` is what bango gives to draw with.
return [{
  id: 'class-diagram',
  label: 'Class diagram',
  create(ctx, kit) {
    const canvas = new kit.Canvas({ onSelect: key => ctx.inspect(/* the path of that node, or null */ null) });
    return {
      mount: el => canvas.mount(el),
      update: state => canvas.render(/* nodes */ [], /* edges */ [], ctx.layout.get()),
      dispose: () => canvas.dispose()
    };
  }
}];
```

The host gives the renderer a store of them, and asks it which views a metamodel has:

```ts
const visualizations = new VisualizationStore();
visualizations.set('datamodel', textOfTheFile);            // or .load({ datamodel: ..., sensors: ... })

const view = new ModelRenderer(bango, { visualizations, layouts });
view.views('datamodel');       // [{ id: 'text', ... }, ..., { id: 'viz:class-diagram', label: 'Class diagram', kind: 'visualization' }]
await view.mount(el, 'datamodel', 'viz:class-diagram');
```

| | |
|---|---|
| `ctx` | the usual `engine`, `metamodel` and `reveal`, plus `layout` (`get()` / `set(positions)`: where this view's nodes are, kept by the host) and `inspect(path)` (open the node at that path in the panel at the side, a form for that node alone; `null` closes it) |
| `kit.Canvas` | a pannable, zoomable canvas of draggable nodes of any size that you draw with SVG, joined by edges with arrowheads and labels at their ends. Selection, Delete, double-click, and a handle to drag a connection from one node to another. `render(nodes, edges, savedPositions)` keeps the positions people left and lays out the rest |
| `kit.editor(engine, metamodel, onFailure)` | edits the instance by its tree (`add`, `addNamed`, `addValue`, `set`, `remove`); what the grammar refuses is reported to `onFailure`, not thrown |
| `kit.boxLayout`, `kit.columnLayout` | where to put boxes of any size to begin with |
| `kit.h`, `kit.svg`, `kit.walk`, `kit.nodeAt`, `kit.fit` | DOM and tree helpers |

- **What is offered** reaches every visualization in `update(state)`: `state.offered` are the read-only instances that others contribute (`engine.setContributed`: what a module adds to the data model, say), of any metamodel, with their trees (`ast`), only the ones that could be read. A view draws them next to the instance's own (the class diagram draws the entities a module offers dashed and locked, with who offers them, and an *Offered* button hides them), and must not edit them: their paths are in another instance.
- **Where the nodes are** is the host's: `layouts` is a `LayoutStore` (`get(metamodel, view)`, `set(metamodel, view, positions)`). `MemoryLayoutStore` keeps them in memory, with `toJSON()` to save, `load()` to give them back and `subscribe()` to know when one moved; LINEA saves them next to the model in the product's repository, the playground in the project. Without a store, nodes are laid out again each time the page loads.
- **Changing the file** redraws the view from the new text: the studio's *Visualizations* tab and the playground's editor are live. A file that does not load, or a view that throws while drawing, is a message where the view was, never a crash; `view.views()` carries the reason.
- **Trust.** The file runs in the page, with everything the page has: bango does not sandbox it. It is as trusted as the package that holds it, like the scripts a metamodel brings. A host that loads packages from places it does not trust decides what to do before it gives them to the store.
- **Typings.** `VISUALIZATION_TYPINGS` declares `kit`, `Visualization`, `Visualizations` and the rest, for an editor that completes the file.

## Custom element

```html
<bango-instance metamodel="datamodel" view="form"></bango-instance>
<script type="module">
  import { defineBangoElements } from '@bango/renderer';
  defineBangoElements();
  document.querySelector('bango-instance').engine = bango;
</script>
```

Change the `view` or `metamodel` attribute at any time. A view asking to show source fires a bubbling, cancelable `bango-reveal` event (`detail: { metamodel, range }`); cancel it to handle the request yourself.

## Theming

The default look is dark and comes from CSS variables read from any ancestor, so a page themes the views by setting them:

```css
.my-app {
  --bango-bg: #fff;  --bango-panel: #f1f3f7;  --bango-fg: #1c2230;  --bango-line: #d7dce6;  --bango-input: #eef1f6;
  --bango-accent: #2563eb;  --bango-err: #c9302c;  --bango-warn: #a76a00;  --bango-ok: #1a7f45;
  --bango-key: #2563eb;  --bango-val: #a76a00;  --bango-num: #1a7f45;  --bango-lit: #8250df;  --bango-tint: #8882;
}
```

`injectStyles()` adds the stylesheet (done by `ModelRenderer`); `CSS` is its text.

## Without a bundler

`@bango/renderer/bundle` is one self-contained ES module with every view and the `text` registration. See [`examples/plain`](../../examples/plain/index.html).

## Source layout

```
src/host/    ModelRenderer, view registry, <bango-instance>, types
src/visualizations/  what a metamodel's own views are given: canvas, layouts, tree edits; the store and the loader
src/views/   text (Monaco), form, diagram, ast, json
src/dom/     DOM helpers and the default stylesheet
src/bundle/  entry of the self-contained browser build
```
