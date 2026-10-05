# How Bango is tested

`npm test` runs everything (about 390 tests, a minute). The suites are of three kinds.

## Behaviour of one thing

One file per feature, small and specific: `composer.test.ts`, `collisions.test.ts`, `typings.test.ts`, `validators.test.ts`, `import.test.ts`, `cases.test.ts`, `editing-power.test.ts`, `edit-guards.test.ts`, `workspace.test.ts`, `worker.test.ts` (the same API through a real message channel), the renderer tests (in happy-dom). When something is fixed, its test names the case that failed.

## Properties that must hold for every metamodel

These do not know any metamodel by name. They take what ships in `examples/seed` (`test-support/seed.ts`: `METAMODELS`, `EXAMPLE_PROJECTS`) and ask a question of each, so a new metamodel is tested the day it is added, without writing a test for it. The list of what ships is in one place; update it when you add one.

| Suite | Property |
|---|---|
| `selections.test.ts` | for **all 255 selections** of the eight metamodels, `check()` agrees with an oracle built from the `import` lines of the grammar text (it does not use the composer); what it suggests is itself valid; the order a selection is written in never changes the project JSON |
| `integrity.test.ts` | in every example project, **every kind of reference** pointed at something that does not exist is exactly one error, in its own instance; **renaming** what is declared changes every use in every instance, and renaming back restores every text byte for byte |
| `fuzz.test.ts` | seeded **random edits** (add, set, remove, from each instance's form schema): the text always parses, `undo` restores the original exactly, `redo` replays. Deeper run: `FUZZ_SEEDS=1,2,3,4,5,6,7,8 FUZZ_STEPS=60 npx vitest run packages/engine/test/fuzz.test.ts` |
| `churn.test.ts` | grammars changing under a running project: break and repair (identity in the end), remove and restore, a clashing metamodel joining and leaving, constraints and mappings that throw, cyclic and missing imports, and **calls in flight at once** ending in the same state as the same calls one after another |
| `langium-conformance.test.ts` | each metamodel through **plain Langium** (no Bango engine): the composed grammar is accepted, and Langium reports exactly what Bango reports for every shipped instance |
| `incremental.test.ts` | the incremental engine says exactly what a full rebuild says, after every step of random edits, broken texts, removals and undos |
| `watchdog.test.ts` | an engine that stops answering is replaced, the culprit script is quarantined, the rest comes back (with a fake worker that goes silent; the real loop is in `e2e/`) |
| `limits.test.ts` | instances and grammars over the size limits, text nested too deeply, a long line, many tiny entities, CRLF |
| `scope.test.ts` | scope scripts: a reference sees only what is visible where it is written (completion, definition, rename, find references, form candidates, new nodes start resolved), scripts that fail or lie, and the same provider in plain Langium services |
| `new-metamodels.test.ts` | the chains that stress composition: a type three metamodels contribute to, a diamond of imports, recursion, a slot another metamodel fills, in every composition order |

## What it costs

`bench.test.ts` generates a project nobody would write by hand (`test-support/generate.ts`: entities with fields and a relation, a form for every second one, a list for every fifth, 20 roles, 40 users, hundreds of grants) and times the engine on it. Typical numbers on a laptop, median of several runs (the limits in the test are several times these, so a real regression fails and a slow day does not):

| 500 entities (92 KB data model, 130 KB in all) | |
|---|---|
| load every instance | ~100 ms |
| a change to a metamodel that nothing needs (`security`) | ~10 ms |
| ... to `forms` (needed by `security`) | ~20 ms |
| ... to the data model (needed by all) | ~80 ms |
| a form edit, the project JSON | ~10 ms, ~5 ms |

An edit remakes only the instance documents it can have reached: the changed one and the metamodels that need it. At 1000 entities a change to a leaf costs ~17 ms; remaking everything, as the engine used to, costs ~190 ms (`new Bango({ incremental: false })` is still there, as the reference). `incremental.test.ts` holds the fast way to the slow way: two engines driven through the same random edits, broken texts, removals and undos must say **exactly** the same about every instance after every step.

## What the suites found

Writing them found, and fixed, things that single-case tests had not:

- the merged type reflection kept only the last metamodel's idea of a shared type, so adding `gismodel` to a project with `security` made every reference to a `Resource` stop resolving;
- the merged project JSON depended on the order metamodels were selected in when two needed the same number of others;
- removing the last element of a list the grammar requires produced text that could not parse (it is now refused, with the reason);
- removing the only child of a node left an empty `{ }` behind;
- adding a node whose field is a data type rule (an interval bound) started it with text the grammar rejects;
- `Bango` ordered the composer's calls but not the engine's, so `compose(...)` followed by an un-awaited `applyEdit(...)` could fail;
- editing two grammars close together lost the first (the workspace debounce was shared);
- a text nested too deeply for the parser threw out of the call instead of being a problem of that instance (now: `could not be read: it is nested too deeply`, and the rest is intact).

## Writing a test for a new metamodel

Give it a `<name>.cases.json` (see [Testing a metamodel](writing-metamodels.md#6-testing-a-metamodel)): one valid sample and one case per rule. `cases.test.ts` runs every file. Add the metamodel to `METAMODELS` and, if it has a project, to `EXAMPLE_PROJECTS`; the generic suites then cover it.
