import { Bango } from '@bango/engine';
import { loadSeed, type Seed, type SeedProject } from './seed.js';

export const errors = (ps: { severity: string; message: string }[]) =>
  ps.filter(p => p.severity === 'error').map(p => p.message);

export interface Opened {
  bango: Bango;
  seed: Seed;
  project: SeedProject;
}

/** A Bango with every seed grammar loaded, the project's metamodels composed and its instances set. */
export async function openProject(name: string, bango = new Bango()): Promise<Opened> {
  const seed = loadSeed();
  const project = seed.projects[name];
  for (const [n, text] of Object.entries(seed.grammars)) await bango.setGrammar(n, text);
  for (const [n, code] of Object.entries(seed.constraints)) await bango.setConstraints(n, code);
  for (const [n, code] of Object.entries(seed.specs)) await bango.setSpec(n, code);
  await bango.compose(project.metamodels);
  for (const [metamodel, text] of Object.entries(project.instances)) await bango.setText(metamodel, text);
  return { bango, seed, project };
}
