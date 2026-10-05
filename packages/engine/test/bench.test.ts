import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { generateProject } from '../../../test-support/generate.js';
import { errors } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

/**
 * What it costs, on a project of a size nobody has written by hand: 500 entities (92 KB), 250 forms, 100 lists, 20 roles, 40 users and
 * hundreds of grants. The numbers in docs/testing.md come from this file; the limits here are several times what a normal machine needs,
 * so they fail on a real regression and not on a slow day.
 */
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timed(fn: () => Promise<unknown>, times = 5) {
  const out: number[] = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return median(out);
}

async function load(entities: number, incremental = true) {
  const seed = loadSeed();
  const project = generateProject({ entities });
  const bango = new Bango({ incremental });
  for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
  for (const [n, c] of Object.entries(seed.constraints)) await bango.setConstraints(n, c);
  for (const [n, c] of Object.entries(seed.specs)) await bango.setSpec(n, c);
  return { bango, project };
}

describe('a big project', () => {
  it('is valid, and the generator makes what it says', async () => {
    const { bango, project } = await load(500);
    await bango.compose(project.selection);
    await bango.setInstances(project.instances);
    for (const s of await bango.getInstances()) expect(errors(s.problems), s.metamodel).toEqual([]);
    expect(project.instances.datamodel.match(/^entity /gm)).toHaveLength(500);
    expect((await bango.build('big')).ok).toBe(true);
  }, 120_000);

  it('composes, loads, edits and exports within budget', async () => {
    const { bango, project } = await load(500);
    const compose = await timed(() => bango.compose(project.selection), 3);
    const setAll = await timed(() => bango.setInstances(project.instances), 3);
    let n = 0;
    const leaf = await timed(() => bango.setText('security', project.instances.security + ' '.repeat(++n)));
    const middle = await timed(() => bango.setText('forms', project.instances.forms + ' '.repeat(++n)));
    const root = await timed(() => bango.setText('datamodel', project.instances.datamodel + ' '.repeat(++n)));
    const form = await timed(() => bango.applyEdit('security', { kind: 'set', path: [{ feature: 'roles', index: 1 }], feature: 'name', value: 'renamed' + ++n }));
    const json = await timed(() => bango.toProjectJson());
    console.log(`500 entities: compose ${compose.toFixed(0)} ms, load ${setAll.toFixed(0)} ms, edit security ${leaf.toFixed(0)} ms, forms ${middle.toFixed(0)} ms, datamodel ${root.toFixed(0)} ms, form edit ${form.toFixed(0)} ms, json ${json.toFixed(0)} ms`);
    expect(compose).toBeLessThan(3000);
    expect(setAll).toBeLessThan(3000);
    for (const [what, ms] of Object.entries({ leaf, middle, root, form })) expect(ms, `${what} edit`).toBeLessThan(1000);
    expect(json).toBeLessThan(500);
  }, 180_000);

  it('an edit costs what it touches: a metamodel that others need costs more than one that nothing needs', async () => {
    const { bango, project } = await load(1000);
    await bango.compose(project.selection);
    await bango.setInstances(project.instances);
    let n = 0;
    // security is a leaf (nothing needs it); the data model is needed by all the others
    const leaf = await timed(() => bango.setText('security', project.instances.security + ' '.repeat(++n)), 7);
    const root = await timed(() => bango.setText('datamodel', project.instances.datamodel + ' '.repeat(++n)), 7);
    console.log(`1000 entities: edit of a leaf ${leaf.toFixed(0)} ms, of the root ${root.toFixed(0)} ms`);
    expect(leaf).toBeLessThan(root);
  }, 180_000);

  it('the incremental engine is faster than remaking everything, on the edits that most people make (a leaf)', async () => {
    const results: Record<string, number> = {};
    for (const incremental of [true, false]) {
      const { bango, project } = await load(1000, incremental);
      await bango.compose(project.selection);
      await bango.setInstances(project.instances);
      let n = 0;
      results[incremental ? 'incremental' : 'full'] = await timed(() => bango.setText('security', project.instances.security + ' '.repeat(++n)), 7);
    }
    console.log(`1000 entities, edit of a leaf: incremental ${results.incremental.toFixed(0)} ms, full ${results.full.toFixed(0)} ms`);
    expect(results.incremental).toBeLessThan(results.full / 2);
  }, 180_000);
});
