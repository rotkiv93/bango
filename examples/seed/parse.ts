import type { MetamodelCase } from '@bango/core';

// The layout of `examples/seed`, in one place: the playground (files through `import.meta.glob`) and the tests (files
// through `fs`) both list the files and hand them to `parseSeed`.
//
//   grammars/<name>.langium            a metamodel (or a library grammar)
//   grammars/<name>.constraints.js     its validation rules
//   grammars/<name>.spec.js            its JSON mapping
//   grammars/<name>.cases.json         sample instances and what they must report (MetamodelCase[])
//   projects/<project>/project.json    { "metamodels": [...], "playground": false? }
//   projects/<project>/<metamodel>.instance
//   expected/sensors_gresint.json      the JSON the gresint project must produce

export interface SeedProject {
  name: string;
  metamodels: string[];
  /** metamodel name -> instance text (one document per metamodel) */
  instances: Record<string, string>;
  /** false for fixtures that show what the composer rejects: they are tests, not examples to offer */
  playground: boolean;
}

export interface Seed {
  /** metamodel name -> its test cases */
  cases: Record<string, MetamodelCase[]>;
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

/** `files`: path relative to `examples/seed` (forward slashes) -> text. */
export function parseSeed(files: Record<string, string>): Seed {
  const seed: Seed = { grammars: {}, constraints: {}, specs: {}, cases: {}, projects: {}, expected: { gresint: undefined } };
  const projectFiles = new Map<string, Record<string, string>>();

  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    if (parts[0] === 'grammars' && parts.length === 2) {
      const file = parts[1];
      if (file.endsWith('.constraints.js')) seed.constraints[file.replace(/\.constraints\.js$/, '')] = text;
      else if (file.endsWith('.spec.js')) seed.specs[file.replace(/\.spec\.js$/, '')] = text;
      else if (file.endsWith('.cases.json')) seed.cases[file.replace(/\.cases\.json$/, '')] = JSON.parse(text);
      else seed.grammars[file.replace(/\.langium$/, '')] = text;
    } else if (parts[0] === 'projects' && parts.length === 3) {
      projectFiles.set(parts[1], { ...projectFiles.get(parts[1]), [parts[2]]: text });
    } else if (path === 'expected/sensors_gresint.json') {
      seed.expected.gresint = JSON.parse(text);
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
