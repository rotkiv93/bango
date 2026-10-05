# The playground

A web app to work with metamodels and projects, built on the three packages. It runs **entirely in the browser** (Langium in a web worker, work saved in IndexedDB), so it deploys as a static site: see [Deploying to GitHub Pages](../../docs/deploy-github-pages.md).

```bash
npm run dev           # from the repository root: development server with hot reload
npm run pages         # production build into apps/playground/dist
npm run pages:preview # serve that build
```

## Three pages

### Projects

Your projects as cards, and **+ New project**. The dialog lists the metamodels the composer has, each with a one-line description and what it needs. The **composer decides** whether the choice can be a project. If not (a missing requirement, a grammar with errors, nothing selected), the dialog explains why and offers **Add what is missing**; the project is not created until the answer is yes.

### Project

One tab per metamodel of the project, plus an **Overview**.

- **A metamodel's tab**: its instance, with the views *Text*, *Form*, *Diagram*, *JSON* and *AST*. **Split with text** shows the text beside any of them, always in sync. *Create instance* starts from the smallest valid one. Clicking a problem, a diagram node or an AST entry shows it in the text.
- **Overview**: the state of every instance, the **build** result (and *Download JSON spec* / *Download model*), and *The whole project* as a diagram, merged JSON or AST.
- **Manage metamodels** changes the selection, with the same composer checks as creating a project.

### Metamodels

The grammars shared by every project. Pick one and edit it as *Grammar*, *Constraints*, *JSON mapping*, or see it as *Composed* (the grammar with every import inlined, as the composer builds it) or *AST*. Projects that use it revalidate as you type; a grammar with errors keeps serving its last good version and its instances are marked *stale*. **+ New metamodel** starts from a minimal grammar.

Also: light and dark themes, and **Reset examples** to restore what ships with the repository.

## How it uses the library

| File | |
|---|---|
| `src/bango.worker.ts` | `serveBango()`: Langium runs here, off the UI thread |
| `src/store.ts` | the app state (zustand). Talks to the worker with `connectBango`, mirrors the engine's instances for saving, persists the workspace to IndexedDB |
| `src/InstanceView.tsx` | mounts a library `ModelRenderer` in an element: this is the whole integration of the views |
| `src/CodeEditorView.tsx` | the library's `CodeEditor` for grammars, constraints and mappings |
| `src/monaco.ts`, `src/monaco-features.ts` | Monaco setup: its worker, and just the editor features it needs |
| `src/seed.ts` | loads `examples/seed` into the first workspace |
| `src/ProjectsPage.tsx`, `ProjectPage.tsx`, `MetamodelsPage.tsx` | the three pages |
| `src/MetamodelPicker.tsx` | metamodel cards and the composer's verdict on a selection |

The app runs against the **library sources** (Vite aliases in `vite.config.ts`), so a change in a package shows up immediately.

## Saved work

The workspace (metamodels, constraints, mappings, projects and their instances) is stored in the browser under the key `bango-workspace-v5`; the theme in `localStorage`. Both are per browser and per site. When the examples change in an incompatible way the key is bumped and the examples are loaded again.
