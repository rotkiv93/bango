import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../examples/seed');

export interface SeedProject {
  name: string;
  metamodels: string[];
  /** metamodel name -> instance text (one document per metamodel) */
  instances: Record<string, string>;
}

export interface Seed {
  /** grammar name (file name without extension) -> text */
  grammars: Record<string, string>;
  /** metamodel name -> constraints code */
  constraints: Record<string, string>;
  /** metamodel name -> JSON mapping code */
  specs: Record<string, string>;
  /** the JSON the gresint project is expected to produce */
  expected: { gresint: unknown };
  projects: Record<string, SeedProject>;
}

/** Node-side loader for the shipped examples (the playground has its own `import.meta.glob` version). */
export function loadSeed(): Seed {
  const seed: Seed = {
    grammars: {}, constraints: {}, specs: {}, projects: {},
    expected: { gresint: JSON.parse(readFileSync(join(root, 'expected/sensors_gresint.json'), 'utf8')) }
  };
  const grammarDir = join(root, 'grammars');
  for (const f of readdirSync(grammarDir)) {
    const text = readFileSync(join(grammarDir, f), 'utf8');
    if (f.endsWith('.constraints.js')) seed.constraints[f.replace(/\.constraints\.js$/, '')] = text;
    else if (f.endsWith('.spec.js')) seed.specs[f.replace(/\.spec\.js$/, '')] = text;
    else seed.grammars[f.replace(/\.langium$/, '')] = text;
  }
  const projectDir = join(root, 'projects');
  for (const name of readdirSync(projectDir)) {
    const dir = join(projectDir, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    const instances: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.instance')) instances[f.replace(/\.instance$/, '')] = readFileSync(join(dir, f), 'utf8');
    }
    seed.projects[name] = { name, metamodels: manifest.metamodels, instances };
  }
  return seed;
}
