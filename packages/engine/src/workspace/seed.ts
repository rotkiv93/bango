import type { MetamodelCase } from '@bango/core';
import type { WorkspaceData } from './data.js';

// The layout of a folder of examples (`examples/seed` in this repository), in one place: the playground (files through
// `import.meta.glob`) and the tests (files through `fs`) both list the files and hand them to `parseSeed`.
//
//   grammars/<name>.langium            a metamodel (or a library grammar)
//   grammars/<name>.constraints.js     its validation rules
//   grammars/<name>.spec.js            its JSON mapping
//   grammars/<name>.import.js          the inverse of its JSON mapping: JSON back into its instance
//   grammars/<name>.cases.json         sample instances and what they must report (MetamodelCase[])
//   projects/<project>/project.json    { "metamodels": [...], "playground": false? }
//   projects/<project>/<metamodel>.instance

export interface SeedProject {
  name: string;
  metamodels: string[];
  /** metamodel name -> instance text (one document per metamodel) */
  instances: Record<string, string>;
  /** false for fixtures that show what the composer rejects: they are tests, not examples to offer */
  playground: boolean;
}

export interface Seed {
  grammars: Record<string, string>;
  constraints: Record<string, string>;
  specs: Record<string, string>;
  imports: Record<string, string>;
  cases: Record<string, MetamodelCase[]>;
  projects: Record<string, SeedProject>;
}

/** `files`: path relative to the examples folder (forward slashes) -> text. Files outside the layout are ignored. */
export function parseSeed(files: Record<string, string>): Seed {
  const seed: Seed = { grammars: {}, constraints: {}, specs: {}, imports: {}, cases: {}, projects: {} };
  const projectFiles = new Map<string, Record<string, string>>();

  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    if (parts[0] === 'grammars' && parts.length === 2) {
      const file = parts[1];
      if (file.endsWith('.constraints.js')) seed.constraints[file.replace(/\.constraints\.js$/, '')] = text;
      else if (file.endsWith('.spec.js')) seed.specs[file.replace(/\.spec\.js$/, '')] = text;
      else if (file.endsWith('.import.js')) seed.imports[file.replace(/\.import\.js$/, '')] = text;
      else if (file.endsWith('.cases.json')) seed.cases[file.replace(/\.cases\.json$/, '')] = JSON.parse(text);
      else if (file.endsWith('.langium')) seed.grammars[file.replace(/\.langium$/, '')] = text;
    } else if (parts[0] === 'projects' && parts.length === 3) {
      projectFiles.set(parts[1], { ...projectFiles.get(parts[1]), [parts[2]]: text });
    }
  }

  for (const [name, project] of projectFiles) {
    const manifest = JSON.parse(project['project.json'] ?? '{}');
    const instances: Record<string, string> = {};
    for (const [file, text] of Object.entries(project)) if (file.endsWith('.instance')) instances[file.replace(/\.instance$/, '')] = text;
    seed.projects[name] = { name, metamodels: manifest.metamodels ?? [], instances, playground: manifest.playground !== false };
  }
  return seed;
}

/** The workspace a first visit starts with: the examples. Fixtures that exist to be rejected are left out unless asked for. */
export function workspaceFromSeed(seed: Seed, options: { fixtures?: boolean } = {}): WorkspaceData {
  const projects: WorkspaceData['projects'] = {};
  for (const p of Object.values(seed.projects)) {
    if (p.playground || options.fixtures) projects[p.name] = { name: p.name, metamodels: p.metamodels, instances: p.instances };
  }
  return { grammars: seed.grammars, constraints: seed.constraints, specs: seed.specs, imports: seed.imports, cases: seed.cases, projects };
}
