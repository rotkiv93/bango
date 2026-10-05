# Bango documentation

| Read this | When you want to |
|---|---|
| [Architecture](architecture.md) | understand how the three modules fit together and why |
| [Writing metamodels](writing-metamodels.md) | create a metamodel: the grammar, its constraints and its JSON mapping |
| [The JSON specification](json-spec.md) | understand the JSON an instance, and a whole project, turns into |
| [Deploying to GitHub Pages](deploy-github-pages.md) | publish the playground as a static site |

The three modules each have their own reference:

- [`@bango/composer`](../packages/composer/README.md): composes grammars into languages and checks that a selection fits together
- [`@bango/engine`](../packages/engine/README.md): parses, validates and edits instances; builds the final model
- [`@bango/renderer`](../packages/renderer/README.md): text, form, diagram, AST and JSON views of an instance

And the two things built on them:

- [The playground](../apps/playground/README.md): the web app
- [The examples](../examples/README.md): the metamodels and projects that ship with the repository, and a page that uses the library without a bundler

## The shortest possible tour

```ts
import { Bango } from '@bango/engine';

const bango = new Bango();

// 1. metamodels are Langium grammars (and optionally constraints and a JSON mapping)
await bango.setGrammar('datamodel', datamodelGrammar);
await bango.setGrammar('mapviewer', mapviewerGrammar);          // `import 'datamodel'` inside

// 2. a project chooses the metamodels it uses; the composer checks that they fit together
const check = await bango.checkSelection(['mapviewer']);
check.errors;   // ["'mapviewer' needs 'datamodel': add 'datamodel' to this project"]
await bango.compose(['datamodel', 'mapviewer']);

// 3. a project holds one instance per metamodel; they validate against each other
await bango.setText('datamodel', 'datamodel shop\nentity Road { property geometry: LineString }');
await bango.setText('mapviewer', 'mapviewer\n...');

// 4. read it back as data
await bango.build('shop');               // the final model, or the reasons it cannot be built
await bango.toProjectJson();             // the project's JSON specification
```

Views of an instance are in [`@bango/renderer`](../packages/renderer/README.md).
