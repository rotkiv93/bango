# @bango/composer

Composes [Langium](https://langium.org) grammars (metamodels) into languages, and checks that a selection of them fits together.

It knows about grammars, imports, constraints and JSON mappings. It knows nothing about instances or editors: that is [`@bango/engine`](../engine/README.md).

```ts
import { ModelComposer } from '@bango/composer';

const composer = new ModelComposer();
composer.setGrammar('datamodel', datamodelGrammar);
composer.setGrammar('gismodel', gismodelGrammar);   // contains: import 'datamodel'

const check = await composer.check(['gismodel']);
check.ok;          // false
check.errors;      // ["'gismodel' needs 'datamodel': add 'datamodel' to this project"]
check.suggested;   // ['gismodel', 'datamodel']

const composition = await composer.compose(['datamodel', 'gismodel']);
composition.ok;                              // true
composition.get('gismodel')?.extension;     // 'gismodel'
```

`langium` is a **peer dependency**: install it next to this package (Langium's types break with two copies).

## What it does

- **Inlines imports.** Each metamodel is flattened together with everything it imports, so Langium's parser builder sees one complete grammar. The imported entry rules are dropped: a language has one entry.
- **Derives requirements from imports.** A metamodel *requires* every metamodel it imports, directly or not.
- **Checks selections.** A selection is a valid project when it is not empty, names existing metamodels, includes everything each one requires, and none of them has grammar errors.
- **Keeps serving broken grammars.** If a grammar has errors, its last good version keeps being used and is marked `stale`.
- **Compiles user code once.** Constraints (`<name>.constraints.js`) and JSON mappings (`<name>.spec.js`), reporting syntax errors as problems of the metamodel.
- **Resolves type name clashes.** The metamodels of a project share one index, so two metamodels declaring the same type name (`Entity`, say) would mix. The composer renames the clashing ones for that selection, in a copy of the grammars: the grammar that most metamodels include keeps the name, the others get the grammar's name in front (`other`'s `Entity` becomes `OtherEntity`). Declarations, references (also in importers) and constraint keys are all updated, and instance text and error positions are untouched. [Details](../../docs/writing-metamodels.md#when-two-metamodels-use-the-same-type-name).
- **Reports** two grammars with the same declared name (they would share a file extension).

## API

### `ModelComposer`

| Method | |
|---|---|
| `setGrammar(name, text)` | add or replace a metamodel. `name` is the grammar file name without extension. Returns `this` |
| `removeGrammar(name)` | remove one |
| `setConstraints(name, code)` | the validation rules of the metamodel `name` ([format](../../docs/writing-metamodels.md#2-constraints)) |
| `setSpec(name, code)` | its JSON mapping ([format](../../docs/writing-metamodels.md#3-the-json-mapping)) |
| `setImport(name, code)` | its import mapping: the inverse of the JSON mapping ([format](../../docs/writing-metamodels.md#4-the-import-mapping-optional)) |
| `grammarNames` | the names of the grammars set so far |
| `metamodels(): Promise<GrammarInfo[]>` | every grammar with its description, requirements and problems; libraries have no `extension` |
| `check(selection): Promise<SelectionCheck>` | can this selection be a project? Loads nothing |
| `typings(grammar): Promise<string>` | TypeScript declarations of the AST types of a grammar (imports inlined), plus `Constraints`, `Spec` and the script helpers: load them in an editor and scripts get completion and checks |
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
| `renames: TypeRename[]` | the type names renamed in this composition: `{ file, original, renamed, keeper }` |
| `typeName(node)` | a node's type as its author wrote it (`node.$type` without this composition's renames) |
| `bundleText(name)` | one self-contained `.langium` for the metamodel, imports inlined (valid input for `langium generate`) |
| `grammarAst(name)` | the AST of a grammar itself, as plain data |
| `info(): CompositionInfo` | a serializable summary (no Langium objects): `{ selection, grammars, languages, problems }` |

`GrammarInfo` is `{ name, extension?, description?, imports, requires, problems }`; `LanguageInfo` is `{ name, extension, keywords, stale }`. `info()` also carries `renames`.

### Helpers

| | |
|---|---|
| `toAstDto(node)` | any Langium AST as a plain tree (`AstDto`): `{ type, name?, range?, props, refs, children }` |
| `compileConstraints(code, helpers?)`, `compileSpec(code, helpers?)` | what the composer uses to compile user code. Scripts see `typeName(node)`, `refName(ref)`, `duplicates(items, key)` and, in import mappings, `n(type, features)` (`ScriptHelpers`); `compileImport` is the third compiler; a compiled mapping takes just the root node |
| `CompositeAstReflection` | merges the reflections of several metamodels |
| `toProblem`, `wholeFile` | LSP diagnostic -> `Problem`; a problem about a whole document |
| `documentUri`, `nameOfDocument`, `nameOfPath`, `nameOfUri` | every document lives at `memory:/<name>.<extension>`: these build and read that shape |

## Source layout

```
src/compose/   ModelComposer (orchestration), Composition; grammar-workspace (parse and validate the grammars), requirements,
               script-binder (compile scripts for one composition), collisions (type-name clash planning and rewriting)
src/grammar/   import inlining, merged reflection, self-contained grammar text
src/scripts/   compiles constraints and JSON mappings
src/model/     Langium-bound types, AST -> plain tree, problems, document names
```

See [Architecture](../../docs/architecture.md) for how the composer fits with the engine and renderer.
