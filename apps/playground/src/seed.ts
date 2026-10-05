import { parseSeed } from '../../../examples/seed/parse.js';
import type { Workspace } from './types.js';

const raw = import.meta.glob('../../../examples/seed/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The examples shipped in `examples/seed`: shared metamodels, plus one folder per project. */
export function seedWorkspace(): Workspace {
  const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.slice(path.indexOf('/seed/') + '/seed/'.length), text]));
  const seed = parseSeed(files);
  const projects: Workspace['projects'] = {};
  // fixtures for tests that show what the composer rejects are not offered as examples
  for (const p of Object.values(seed.projects)) if (p.playground) projects[p.name] = { name: p.name, metamodels: p.metamodels, instances: p.instances };
  return { grammars: seed.grammars, constraints: seed.constraints, specs: seed.specs, projects };
}
