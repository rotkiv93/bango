import { describe, expect, it } from 'vitest';
import { ModelComposer } from '@bango/composer';
import { Bango } from '../src/index.js';
import { composerWith, errors } from '../../../test-support/harness.js';
import { METAMODELS, loadSeed } from '../../../test-support/seed.js';

/** The imports of every grammar, read from the grammar text itself: an oracle that does not use the composer. */
function importGraph(grammars: Record<string, string>): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [name, text] of Object.entries(grammars)) {
    graph.set(name, [...text.matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map(m => m[1].replace(/^\.\//, '')));
  }
  return graph;
}

/** Everything a metamodel needs: the metamodels among everything it imports, directly or not. */
function requirements(graph: Map<string, string[]>, name: string): string[] {
  const seen = new Set<string>();
  const walk = (n: string) => {
    for (const next of graph.get(n) ?? []) if (!seen.has(next)) { seen.add(next); walk(next); }
  };
  walk(name);
  return [...seen].filter(n => METAMODELS.includes(n)).sort();
}

/** Every non-empty subset of a list, in a stable order. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

describe('every selection of the shipped metamodels', () => {
  const seed = loadSeed();
  const graph = importGraph(seed.grammars);

  it('the oracle reads the dependencies the documentation promises', () => {
    expect(requirements(graph, 'basic')).toEqual([]);
    expect(requirements(graph, 'sensors')).toEqual(['datamodel', 'gismodel']);
    expect(requirements(graph, 'security')).toEqual(['datamodel', 'forms', 'lists']);
    expect(requirements(graph, 'menus')).toEqual(['datamodel', 'forms', 'gismodel', 'lists']);
  });

  it('check() agrees with the import graph on all 255 selections, and what it suggests is itself valid', async () => {
    const { composer } = composerWith();
    const all = subsets(METAMODELS);
    expect(all).toHaveLength(255);
    for (const names of all) {
      const missing = names.flatMap(n => requirements(graph, n).filter(r => !names.includes(r)).map(r => `${n}>${r}`)).sort();
      const check = await composer.check(names);
      const label = names.join('+');
      expect(check.ok, `${label}: ${check.errors.join('; ')}`).toBe(missing.length === 0);
      expect(check.problems.map(p => `${p.metamodel}>${p.missing}`).sort(), label).toEqual(missing);
      if (!check.ok) expect(check.errors.length, label).toBeGreaterThanOrEqual(1);

      // the suggestion is the selection plus everything it requires, and that is valid
      const closure = [...new Set([...names, ...names.flatMap(n => requirements(graph, n))])].sort();
      expect([...check.suggested].sort(), label).toEqual(closure);
      if (!check.ok) expect((await composer.check(check.suggested)).ok, `${label} -> ${closure.join('+')}`).toBe(true);
    }
  }, 300_000);

  it('composing never throws, and exactly the metamodels whose requirements are selected are usable', async () => {
    const { composer } = composerWith();
    for (const names of subsets(METAMODELS).filter((_, i) => i % 3 === 0)) {
      const composition = await composer.compose(names);
      const usable = names.filter(n => requirements(graph, n).every(r => names.includes(r)));
      expect(composition.metamodels.map(m => m.name).sort(), names.join('+')).toEqual(usable.sort());
      for (const n of names.filter(n => !usable.includes(n))) expect(composition.explainUnavailable(n), `${names.join('+')}: ${n}`).toMatch(/needs/);
    }
  }, 300_000);

  it('a selection with something that is not a metamodel, a library, or nothing at all, is refused with a reason', async () => {
    const { composer } = composerWith();
    for (const names of [[], ['ghost'], ['common'], ['datamodel', 'ghost'], ['datamodel', 'datamodel']]) {
      const check = await composer.check(names);
      const duplicates = names.length === 2 && names[0] === names[1];
      expect(check.ok, JSON.stringify(names)).toBe(duplicates);
      if (!check.ok) expect(check.errors.length).toBeGreaterThan(0);
    }
    // the same name twice is the same selection
    expect((await composer.compose(['datamodel', 'datamodel'])).selection).toEqual(['datamodel']);
  });
});

describe('the order of a selection never matters', () => {
  // a small deterministic shuffle: no randomness in a test that must be repeatable
  const shuffled = <T,>(items: T[], seed: number) => {
    const out = [...items];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  it.each(['gresint', 'office', 'portal', 'everything'])('%s: the project JSON and every instance are the same in any order', async name => {
    const seed = loadSeed();
    const project = seed.projects[name];
    const results: string[] = [];
    for (const order of [project.metamodels, [...project.metamodels].reverse(), shuffled(project.metamodels, 1), shuffled(project.metamodels, 7)]) {
      const bango = new Bango();
      for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
      for (const [n, c] of Object.entries(seed.constraints)) await bango.setConstraints(n, c);
      for (const [n, c] of Object.entries(seed.specs)) await bango.setSpec(n, c);
      await bango.compose(order);
      // instances arrive in the order of the selection as well
      await bango.setInstances(Object.fromEntries(order.map(m => [m, project.instances[m]])));
      for (const s of await bango.getInstances()) expect(errors(s.problems), `${name} ${order.join('>')}: ${s.metamodel}`).toEqual([]);
      results.push(JSON.stringify(await bango.toProjectJson()));
    }
    expect(new Set(results).size, name).toBe(1);
  });
});

describe('composing again and again', () => {
  it('the same selection gives the same composition each time, and an unrelated edit does not change it', async () => {
    const { composer } = composerWith();
    const first = await composer.compose(['datamodel', 'forms', 'security', 'lists']);
    const second = await composer.compose(['security', 'lists', 'forms', 'datamodel']);
    expect(second.info().languages.map(l => l.name).sort()).toEqual(first.info().languages.map(l => l.name).sort());
    composer.setGrammar('unrelated', "grammar Unrelated\nimport 'common'\nentry U: 'u' name=ID;\n");
    const third = await composer.compose(['datamodel', 'forms', 'security', 'lists']);
    expect(third.info().languages.map(l => l.name).sort()).toEqual(first.info().languages.map(l => l.name).sort());
    expect(third.renames).toEqual([]);
    void (composer satisfies ModelComposer);
  });
});
