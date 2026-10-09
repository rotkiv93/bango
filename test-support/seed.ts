import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSeed, type Seed as LibrarySeed, type SeedProject } from '@bango/engine/workspace';

export type { SeedProject };

/** The shipped examples, plus the JSON the gresint project is expected to produce (what the tests compare against). */
export interface Seed extends LibrarySeed {
  expected: { gresint: unknown };
}

const root = join(import.meta.dirname, '../examples/seed');
// what only the tests use: the `security` metamodel (a stress case for the engine, no longer shipped) and the projects built on it
const fixtures = join(import.meta.dirname, 'fixtures');

/** Node-side loader for the shipped examples (the playground lists the same files with `import.meta.glob`); `fixtures` adds what only the tests have. */
export function loadSeed(options: { fixtures?: boolean } = {}): Seed {
  const files: Record<string, string> = {};
  for (const folder of options.fixtures ? [root, fixtures] : [root]) {
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files[relative(folder, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
    }
  }
  return { ...parseSeed(files), expected: { gresint: JSON.parse(files['expected/sensors_gresint.json']) } };
}

/** The metamodels that ship in `examples/seed/grammars` (the ones with an entry rule), sorted. Update it when one is added. */
export const METAMODELS = ['basic', 'datamodel', 'forms', 'gismodel', 'lists', 'menus', 'sensors', 'statics'];

/** The projects the playground offers as examples, sorted. */
export const EXAMPLE_PROJECTS = ['catalog', 'city', 'everything', 'fleet', 'gresint', 'office', 'portal', 'shop'];
