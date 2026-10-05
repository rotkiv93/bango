import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

describe('project build', () => {
  it('a data-model-only project builds into a final model', async () => {
    const { bango } = await openProject('shop');
    const result = await bango.build('shop');
    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.model!.metamodels.map(m => m.name)).toEqual(['datamodel']);
    expect(result.model!.instances.map(i => i.metamodel)).toEqual(['datamodel']);
  });

  it('data + map model build together and keep the cross-metamodel reference', async () => {
    const { bango } = await openProject('city');
    const result = await bango.build('city');
    expect(result.ok, result.errors.join('\n')).toBe(true);
    const map = result.model!.instances.find(i => i.metamodel === 'mapviewer')!;
    expect(map.extension).toBe('mapviewer');
    const layers = map.ast.children.layers as unknown as { refs: { entity: { resolved: boolean; targetMetamodel: string } } }[];
    expect(layers[0].refs.entity).toMatchObject({ resolved: true, targetMetamodel: 'datamodel' });
  });

  it('a map model without the data model fails and tells the user to add it', async () => {
    const { bango } = await openProject('map-only');
    const result = await bango.build('city');
    expect(result.ok).toBe(false);
    expect(result.model).toBeUndefined();
    expect(result.errors.join('\n')).toMatch(/'mapviewer' needs 'datamodel': add 'datamodel' to this project/);
  });

  it('requirements are transitive: the composite metamodel needs both of the others', async () => {
    const { bango } = await openProject('composite');
    const info = await bango.compose(['app', 'datamodel']);
    expect(info.grammars.find(g => g.name === 'app')!.requires.sort()).toEqual(['datamodel', 'mapviewer']);
    expect(info.problems.map(p => p.missing)).toEqual(['mapviewer']);
    const result = await bango.build('composite');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/'app' needs 'mapviewer'/);
  });

  it('an instance of a metamodel outside the project fails the build', async () => {
    const { bango, project } = await openProject('shop');
    await bango.setText('mapviewer', 'mapviewer');
    const result = await bango.build('shop');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/mapviewer: .*not part of this project/);
    await bango.removeInstance('mapviewer');
    expect((await bango.build('shop')).ok, JSON.stringify(project)).toBe(true);
  });

  it('fails on unresolved references and passes once fixed', async () => {
    const { bango, project } = await openProject('city');
    await bango.setText('mapviewer', project.instances.mapviewer.replace('entity Road', 'entity Nope'));
    const failed = await bango.build('city');
    expect(failed.ok).toBe(false);
    expect(failed.errors.join('\n')).toMatch(/mapviewer 3:\d+ .*Nope/);

    await bango.setText('mapviewer', project.instances.mapviewer);
    const fixed = await bango.build('city');
    expect(fixed.ok, fixed.errors.join('\n')).toBe(true);
  });

  it('constraint warnings do not block the build but are reported', async () => {
    const { bango } = await openProject('city');
    const result = await bango.build('city');
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toMatch(/exactly one pk property/);
  });

  it('grammar errors in a selected metamodel fail the build', async () => {
    const { bango, seed } = await openProject('shop');
    await bango.setGrammar('datamodel', seed.grammars.datamodel.replace('Entity:', 'Thing:'));
    await bango.compose(['datamodel']);
    const result = await bango.build('shop');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/datamodel\.langium/);
  });

  it('building before composing explains what is missing', async () => {
    expect((await new Bango().build('x')).errors).toEqual(['No composition loaded']);
  });

  it('with no selection every metamodel is part of the project', async () => {
    const seed = loadSeed();
    const bango = new Bango();
    for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
    const info = await bango.compose();
    expect(info.problems).toEqual([]);
    expect(info.languages.map(l => l.name).sort()).toEqual(['app', 'datamodel', 'mapviewer', 'sensors']);
  });

  it.each([
    ['shop', true],
    ['city', true],
    ['composite', true],
    ['gresint', true],
    ['map-only', false],
    ['sensors-only', false]
  ])('shipped example %s builds: %s', async (name, ok) => {
    const { bango } = await openProject(name);
    const result = await bango.build(name);
    expect(result.ok, result.errors.join('\n')).toBe(ok);
    if (!ok) expect(result.errors.join('\n')).toMatch(/needs 'datamodel'/);
  });
});
