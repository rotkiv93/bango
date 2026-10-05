import { describe, expect, it } from 'vitest';
import { Bango, type EngineEvent } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';

describe('setInstances', () => {
  it('replaces every instance with one rebuild and one event', async () => {
    const { bango, seed } = await openProject('city');
    const seen: EngineEvent[] = [];
    await bango.subscribe(e => seen.push(e));
    const states = await bango.setInstances({ datamodel: seed.projects.shop.instances.datamodel });
    expect(states.map(s => s.metamodel)).toEqual(['datamodel']);
    expect((await bango.getInstances()).map(s => s.metamodel)).toEqual(['datamodel']);
    expect(seen).toEqual([{ type: 'instances' }]);
  });

  it('switching projects does not leak instances of the previous one', async () => {
    const { bango, seed } = await openProject('city');
    await bango.compose(['datamodel']);
    await bango.setInstances(seed.projects.shop.instances);
    const all = await bango.getInstances();
    expect(all.map(s => s.metamodel)).toEqual(['datamodel']);
    expect(errors(all[0].problems)).toEqual([]);
  });
});

describe('createInstance', () => {
  it.each([
    ['datamodel', /^datamodel\s*$/],
    ['gismodel', /^gismodel\s*$/]
  ])('starts a %s instance with its minimal valid root', async (metamodel, pattern) => {
    const { bango } = await openProject('city');
    await bango.removeInstance(metamodel);
    const s = await bango.createInstance(metamodel);
    expect(s.text).toMatch(pattern);
    expect(errors(s.problems)).toEqual([]);
    expect(s.available).toBe(true);
  });

  it('returns the existing instance instead of replacing it', async () => {
    const { bango, project } = await openProject('city');
    expect((await bango.createInstance('datamodel')).text).toBe(project.instances.datamodel);
  });

  it('refuses a metamodel that is not available, with the reason', async () => {
    const { bango } = await openProject('shop');
    await expect(bango.createInstance('gismodel')).rejects.toThrow(/not part of this project/);
  });
});

describe('grammar AST', () => {
  it('exposes the AST of any grammar of the workspace, resolved references included', async () => {
    const { bango } = await openProject('city');
    const ast = (await bango.getGrammarAst('gismodel'))!;
    expect(ast.type).toBe('Grammar');
    const imports = ast.children.imports as { props: Record<string, unknown> }[];
    expect(imports.map(i => i.props.path)).toEqual(['common', 'datamodel']);
    expect(await bango.getGrammarAst('nope')).toBeUndefined();
  });
});

describe('Bango ordering', () => {
  it('overlapping compose calls apply in call order, so the last selection wins', async () => {
    const { bango } = await openProject('city');
    const calls = [
      bango.compose(['datamodel', 'gismodel']),
      bango.compose(['datamodel']),
      bango.compose(['datamodel', 'gismodel']),
      bango.compose(['datamodel'])
    ];
    const infos = await Promise.all(calls);
    expect(infos.map(i => i.languages.length)).toEqual([2, 1, 2, 1]);
    expect((await bango.getComposition())!.languages.map(l => l.name)).toEqual(['datamodel']);
  });

  it('a grammar edit followed by compose is seen by that compose', async () => {
    const { bango, seed } = await openProject('shop');
    void bango.setGrammar('datamodel', seed.grammars.datamodel.replace("'entity'", "'thing'"));
    const info = await bango.compose(['datamodel']);
    expect(info.languages[0].keywords).toContain('thing');
    expect(info.languages[0].keywords).not.toContain('entity');
  });

  it('bundleText before any compose says what to do', async () => {
    await expect(new Bango().bundleText('x')).rejects.toThrow(/compose/);
  });
});
