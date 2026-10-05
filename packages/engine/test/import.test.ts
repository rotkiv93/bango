import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

const GRESINT = ['basic', 'datamodel', 'gismodel', 'sensors'];

describe('importing a project from its JSON', () => {
  it('the gresint JSON becomes instances that produce that same JSON again', async () => {
    const { bango, seed } = await openProject('gresint');
    const expected = seed.expected.gresint;

    const result = await bango.importJson(expected as never);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(Object.keys(result.texts).sort()).toEqual(['basic', 'datamodel', 'gismodel', 'sensors']);
    // every new instance is fine, checked next to the others
    for (const [metamodel, problems] of Object.entries(result.problems)) expect(errors(problems), metamodel).toEqual([]);

    // nothing was changed by importing
    expect((await bango.getInstance('datamodel')).text).toBe(seed.projects.gresint.instances.datamodel);

    // use the new instances: the project's JSON is the file we started from
    await bango.setInstances(result.texts);
    expect(await bango.toProjectJson()).toEqual(expected);
    for (const s of await bango.getInstances()) expect(errors(s.problems), s.metamodel).toEqual([]);
  });

  it('a project that is imported and exported again gives the same texts (a fixed point)', async () => {
    const { bango, seed } = await openProject('gresint');
    const first = await bango.importJson(seed.expected.gresint as never);
    await bango.setInstances(first.texts);
    const second = await bango.importJson(await bango.toProjectJson());
    expect(second.texts).toEqual(first.texts);
  });

  it('the texts read like the ones people write: defaults and repeated labels are left out', async () => {
    const { bango, seed } = await openProject('gresint');
    const { texts } = await bango.importJson(seed.expected.gresint as never);
    // defaults of the sensor DSL are not spelled out
    expect(texts.basic).not.toMatch(/languages|srid|index |package/);
    // `label` only when it differs from the name
    expect(texts.gismodel).not.toMatch(/label "(main|roads)"/);
    // `Long (autoinc)` is `Long autoinc`
    expect(texts.datamodel).not.toContain('(autoinc)');
  });

  it('other projects: the forms, lists and data model of the catalog survive an export and an import', async () => {
    const { bango } = await openProject('catalog');
    const json = await bango.toProjectJson();
    const original = await bango.getInstances();
    const result = await bango.importJson(json);
    expect(result.errors).toEqual([]);
    await bango.setInstances(result.texts);
    expect(await bango.toProjectJson()).toEqual(json);
    expect((await bango.getInstances()).map(i => i.metamodel).sort()).toEqual(original.map(i => i.metamodel).sort());
    for (const s of await bango.getInstances()) expect(errors(s.problems), s.metamodel).toEqual([]);
  });

  it('a metamodel without an import mapping is skipped, and said so', async () => {
    const { bango, seed } = await openProject('gresint');
    await bango.setImport('sensors', '');
    await bango.compose(GRESINT);
    const result = await bango.importJson(seed.expected.gresint as never);
    expect(result.skipped).toEqual(['sensors']);
    expect(result.texts.sensors).toBeUndefined();
  });

  it('a failing mapping is reported with its metamodel, and the others still import', async () => {
    const { bango, seed } = await openProject('gresint');
    await bango.setImport('datamodel', "return function (json, { n }) { return n('Model', { entities: json.nope.entities }); };");
    await bango.compose(GRESINT);
    const result = await bango.importJson(seed.expected.gresint as never);
    expect(result.errors.join()).toMatch(/import mapping of 'datamodel' failed/);
    expect(result.texts.datamodel).toBeUndefined();
    expect(result.texts.basic).toBeDefined();
  });

  it('says what is wrong when a mapping describes a node that the grammar does not have', async () => {
    const { bango, seed } = await openProject('gresint');
    const run = async (code: string) => {
      await bango.setImport('datamodel', code);
      await bango.compose(GRESINT);
      return (await bango.importJson(seed.expected.gresint as never)).errors.join();
    };
    expect(await run("return function (json, { n }) { return n('Nope', {}); };")).toMatch(/there is no node type 'Nope'/);
    expect(await run("return function (json, { n }) { return n('Model', { entites: [] }); };")).toMatch(/'Model' has no feature 'entites' \(it has name, entities\)/);
    expect(await run("return function (json, { n }) { return n('Model', { entities: 'x' }); };")).toMatch(/expected n\('Type'/);
    expect(await run("return function (json, { n }) { return n('Model', { name: ['a'] }); };")).toMatch(/takes one value, not a list/);
    expect(await run("return 42;")).toBe('');
  });

  it('a mapping that does not compile is a problem of the metamodel, not a crash', async () => {
    const { bango, seed } = await openProject('gresint');
    await bango.setImport('datamodel', 'return 42;');
    const info = await bango.compose(GRESINT);
    expect(info.grammars.find(g => g.name === 'datamodel')!.problems.map(p => p.message).join()).toMatch(/datamodel\.import\.js: an import mapping must/);
    expect(info.languages.find(l => l.name === 'datamodel')!.canImport).toBe(false);
    expect(info.languages.find(l => l.name === 'basic')!.canImport).toBe(true);
    // the rest of the project keeps working
    expect((await bango.importJson(seed.expected.gresint as never)).texts.basic).toBeDefined();
  });

  it('without a composition there is nothing to import into', async () => {
    const result = await new Bango().importJson({});
    expect(result.errors.join()).toMatch(/No composition loaded/);
    expect(result.texts).toEqual({});
  });

  it('does not disturb the instances being worked on, and is plain data', async () => {
    const { bango, seed } = await openProject('gresint');
    const before = await bango.getInstances();
    const result = await bango.importJson(seed.expected.gresint as never);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(await bango.getInstances()).toEqual(before);
    // and through the worker boundary, the methods exist
    expect(Object.keys(loadSeed().imports).sort()).toEqual(['basic', 'datamodel', 'forms', 'gismodel', 'lists', 'sensors']);
  });
});
