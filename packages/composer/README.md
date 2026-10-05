# @bango/composer

Composes [Langium](https://langium.org) grammars (metamodels) into languages, and checks that a selection of them fits together.

It knows about grammars, imports, constraints and JSON mappings. It knows nothing about instances or editors: that is [`@bango/engine`](../engine/README.md).

```ts
import { ModelComposer } from '@bango/composer';

const composer = new ModelComposer();
composer.setGrammar('datamodel', datamodelGrammar);
composer.setGrammar('mapviewer', mapviewerGrammar);   // contains: import 'datamodel'

const check = await composer.check(['mapviewer']);
check.ok;          // false
check.errors;      // ["'mapviewer' needs 'datamodel': add 'datamodel' to this project"]
check.suggested;   // ['mapviewer', 'datamodel']

const composition = await composer.compose(['datamodel', 'mapviewer']);
composition.ok;                              // true
composition.get('mapviewer')?.extension;     // 'mapviewer'
```

`langium` is a **peer dependency**: install it next to this package (Langium's types break with two copies).

## What it does

- **Inlines imports.** Each metamodel is flattened together with everything it imports, so Langium's parser builder sees one complete grammar. The imported entry rules are dropped: a language has one entry.
- **Derives requirements from imports.** A metamodel *requires* every metamodel it imports, directly or not.
- **Checks selections.** A selection is a valid project when it is not empty, names existing metamodels, includes everything each one requires, and none of them has grammar errors.
- **Keeps serving broken grammars.** If a grammar has errors, its last good version keeps being used and is marked `stale`.
- **Compiles user code once.** Constraints (`<name>.constraints.js`) and JSON mappings (`<name>.spec.js`), reporting syntax errors as problems of the metamodel.
- **Reports clashes.** Two metamodels declaring the same rule name (they share one index), or two grammars with the same declared name (they would share a file extension).

## API

### `ModelComposer`

| Method | |
|---|---|
| `setGrammar(name, text)` | add or replace a metamodel. `name` is the grammar file name without extension. Returns `this` |
| `removeGrammar(name)` | remove one |
| `setConstraints(name, code)` | the validation rules of the metamodel `name` ([format](../../docs/writing-metamodels.md#2-constraints)) |
| `setSpec(name, code)` | its JSON mapping ([format](../../docs/writing-metamodels.md#3-the-json-mapping)) |
| `grammarNames` | the names of the grammars set so far |
| `metamodels(): Promise<GrammarInfo[]>` | every grammar with its description, requirements and problems; libraries have no `extension` |
| `check(selection): Promise<SelectionCheck>` | can this selection be a project? Loads nothing |
| `compose(selection?): Promise<Composition>` | compose a selection (every metamodel when omitted) |

The grammars are rebuilt lazily, on the first call after a change.

### `SelectionCheck`

```ts
interface SelectionCheck {
  ok: boolean;
  errors: string[];                 // everything that is wrong, in plain language
  problems: CompositionProblem[];   // the unmet requirements: { metamodel, missing, message }
  suggested: string[];              // the selection plus everything it requires
}
```

### `Composition`

| Member | |
|---|---|
| `ok` | no unmet requirements and no errors in any metamodel of the selection |
| `selection`, `grammars`, `problems` | what was asked, every grammar's `GrammarInfo`, the unmet requirements |
| `metamodels: ComposedMetamodel[]` | the usable metamodels: `{ name, extension, grammar, reflection, sources, requires, stale, constraints, spec? }` |
| `get(name)`, `byExtension(ext)` | one usable metamodel |
| `explainUnavailable(name)` | why a metamodel cannot be used (not in the project, a missing requirement, grammar errors), or `undefined` |
| `reflection` | all usable metamodels merged, so references between them type-check |
| `bundleText(name)` | one self-contained `.langium` for the metamodel, imports inlined (valid input for `langium generate`) |
| `grammarAst(name)` | the AST of a grammar itself, as plain data |
| `info(): CompositionInfo` | a serializable summary (no Langium objects): `{ selection, grammars, languages, problems }` |

`GrammarInfo` is `{ name, extension?, description?, imports, requires, problems }`; `LanguageInfo` is `{ name, extension, keywords, stale }`.

### Helpers

| | |
|---|---|
| `toAstDto(node)` | any Langium AST as a plain tree (`AstDto`): `{ type, name?, range?, props, refs, children }` |
| `compileConstraints(code)`, `compileSpec(code)` | what the composer uses to compile user code |
| `flatten(grammar, documents)`, `bundleText(flat)`, `hasEntryRule(grammar)` | the grammar utilities behind `compose` |
| `CompositeAstReflection` | merges the reflections of several metamodels |
| `toProblem`, `wholeFile`, `metamodelOfDocument`, `metamodelOfPath` | small conversions shared with the engine |

## Source layout

```
src/compose/   ModelComposer, Composition
src/grammar/   import inlining, merged reflection, self-contained grammar text
src/scripts/   compiles constraints and JSON mappings
src/model/     shared types, AST -> plain tree, problems
```

See [Architecture](../../docs/architecture.md) for how the composer fits with the engine and renderer.
