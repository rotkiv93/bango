# Contributing

## Set up

```bash
npm install
npm run dev          # the playground, against the sources of the packages
```

Node 20 or later. TypeScript 7 is used (its native compiler: there is no JavaScript API, so tools that need one, such as `typescript-eslint`, cannot be used; linting is `oxlint`).

## Before you push

```bash
npm run verify       # typecheck, lint, tests, build, bundle checks, pack-and-install smoke
npm run e2e          # the browser tests (needs a browser, see below)
```

`verify` is what CI runs, one step at a time. Each step on its own:

| | |
|---|---|
| `npm run typecheck` | every package, the playground and the e2e folder |
| `npm run lint` / `npm run knip` | oxlint (correctness; hook warnings are warnings), and unused files, exports and dependencies |
| `npm test` | about 390 tests (see [How Bango is tested](docs/testing.md)); `FUZZ_SEEDS`/`FUZZ_STEPS` run the random edits deeper |
| `npm run build` | the libraries (their bundles and declarations) and the playground |
| `npm run check:bundles` | the promises about what a page loads: a worker client under 16 KB, no Langium in the workspace entry or in the playground's own code |
| `npm run pack:smoke` | packs every package, installs the tarballs into an empty project, imports every entry point, composes/edits/builds, and type-checks a consumer. Run `npm run build:libs` first |
| `npm run e2e` | Playwright against the built playground (`npm run build` first). CI uses Playwright's Chromium (`npx playwright install chromium`); locally `PW_CHANNEL=msedge` (or `chrome`) uses a browser you already have |

## Adding a metamodel

1. `examples/seed/grammars/<name>.langium`, with `.constraints.js`, `.scope.js`, `.spec.js`, `.import.js` and `.cases.json` next to it (see [Writing metamodels](docs/writing-metamodels.md)).
2. A project in `examples/seed/projects/<project>/` that uses it (`project.json` plus one `<metamodel>.instance` per metamodel).
3. Add it to `METAMODELS` (and the project to `EXAMPLE_PROJECTS`) in `test-support/seed.ts`.

The generic suites (all selections, reference integrity, rename round trips, random edits, Langium conformance) then cover it without a line of test code.

## Releasing

Packages share a version. `npm version <patch|minor|major> --workspaces --include-workspace-root --no-git-tag-version`, commit, tag `vX.Y.Z`, push the tag. The `Release` workflow builds, tests, runs the pack smoke and publishes with provenance; it only publishes when the repository has an `NPM_TOKEN` secret.

## Conventions

- Logic belongs in the library. The playground is views and UI state; if you find yourself writing a rule about projects, metamodels or instances there, it goes to `@bango/engine/workspace` (or further down) instead.
- A bug fix comes with the test that failed. Property tests name what they found in `docs/testing.md`.
- Stage files by name; do not `git add -A` (scratch files and screenshots end up in the history).
