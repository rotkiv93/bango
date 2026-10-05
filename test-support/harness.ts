import { ModelComposer } from '@bango/composer';
import { messagesOf, type Problem } from '@bango/core';
import { Bango } from '@bango/engine';
import { loadSeed, type Seed, type SeedProject } from './seed.js';

/** The messages of the problems of one severity. */
export const errors = (ps: Problem[]) => messagesOf(ps, 'error');
export const warnings = (ps: Problem[]) => messagesOf(ps, 'warning');
export const infos = (ps: Problem[]) => messagesOf(ps, 'info');

/** A composer with every seed grammar and constraint loaded, plus `extra` grammars. */
export function composerWith(extra: Record<string, string> = {}) {
  const seed = loadSeed();
  const composer = new ModelComposer();
  for (const [name, text] of Object.entries({ ...seed.grammars, ...extra })) composer.setGrammar(name, text);
  for (const [name, code] of Object.entries(seed.constraints)) composer.setConstraints(name, code);
  return { composer, seed };
}

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
