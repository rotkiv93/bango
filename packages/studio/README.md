# @bango/studio

A workbench to **write one metamodel**, as plain DOM (no framework): its grammar and scripts in editors that know the language, its test cases, the composed grammar, the grammar as a tree, and a live instance in the [renderer's](../renderer/README.md) views.

It owns **no storage** and knows nothing of git, versions or registries. It is given the files, tells you what changed, and you save them wherever they live.

```ts
import { MetamodelStudio } from '@bango/studio';
import * as renderer from '@bango/renderer';
import * as text from '@bango/renderer/text';
import { connectBango } from '@bango/core/client';
import * as monaco from 'monaco-editor';

text.registerTextRenderer(monaco);                       // the page's copy of the renderer: the `text` view of the preview

const studio = new MetamodelStudio({
  bango: connectBango(() => new Worker('/bango.worker.js', { type: 'module' })),   // an engine of the studio's own (see below)
  monaco,
  renderer: { ...renderer, ...text },                    // the page's renderer library, so there is one copy of it
  typescript: async () => monaco.languages.typescript,   // optional: completion and errors in the script editors
  metamodel: 'billing',
  files: { grammar, constraints, spec, import: importJs, scope, cases },     // only `grammar` is required
  dependencies: { common: { grammar: commonGrammar } },  // what it imports, read-only
});
await studio.mount(document.querySelector('#studio')!);

studio.on('change', ({ key }) => showSaveButton(studio.dirty()));   // ['grammar', 'cases', ...]
await save(studio.files);                                          // you save
studio.markSaved();
```

## Tabs

| Tab | |
|---|---|
| Grammar, Constraints, Scope, JSON mapping, JSON import | Monaco editors. The four scripts complete on the AST types of the grammar (`bango.getTypings`) when a `typescript` service is given; otherwise they are plain editors |
| Visualizations | `<name>.visualizations.js`: the views of its instances that this metamodel brings (a class diagram, ...). A Monaco editor that knows what a view is given (`VISUALIZATION_TYPINGS`). The engine never sees the file; the Preview offers what is typed here as views, live |
| Tests | sample instances and the errors they must report (`bango.runCases`); stored in `cases` as a JSON array; "Expect what it reports" turns a failing case into its expectation; "Add case from the preview" |
| Composed | the grammar with every import inlined (`bango.bundleText`) |
| AST | the grammar itself as a tree |
| Preview | a live instance of the metamodel: text, form, diagram, JSON. It starts from `instances` if given, else from the first test case (with the instances it needs), else from a bare instance |
| Imports | the grammars of `dependencies`, read-only |

A library (a grammar with no entry rule) has only the Grammar tab. The status at the top right and the list at the bottom are the problems of the grammar; clicking one shows it in the editor.

## API

- `new MetamodelStudio(input)`; `await studio.mount(el)` loads the metamodel and its dependencies into the engine, composes them and draws.
- `studio.files`: the files as edited. `studio.dirty()`: the keys that differ from what it was given (or from the last `markSaved()`). `studio.markSaved()`. `await studio.reset(files)`: replace the files (discarding changes, loading another version).
- `studio.on('change' | 'problems' | 'catalog', listener)` returns an unsubscribe function. `studio.dispose()`.
- `readOnly: true` shows everything and edits nothing.

## Give it an engine of its own

Composing a metamodel **replaces the composition the engine has loaded**. Do not hand the studio the engine that holds the open project of a playground: use another `connectBango` (a second worker).

## Builds

`@bango/studio` is the library (`dist/index.js`, with types). `@bango/studio/bundle` (`dist/bundle/studio.js`, about 30 KB) is a self-contained ES module for pages without a bundler; it imports nothing, because the page passes in Monaco, the engine and the renderer library.
