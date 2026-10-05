import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSeed, type Seed as LibrarySeed, type SeedProject } from '@bango/engine/workspace';

export type { SeedProject };

/** The shipped examples, plus the JSON the gresint project is expected to produce (what the tests compare against). */
export interface Seed extends LibrarySeed {
  expected: { gresint: unknown };
}

const root = join(import.meta.dirname, '../examples/seed');

/** Node-side loader for the shipped examples (the playground lists the same files with `import.meta.glob`). */
export function loadSeed(): Seed {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(root, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
  }
  return { ...parseSeed(files), expected: { gresint: JSON.parse(files['expected/sensors_gresint.json']) } };
}
