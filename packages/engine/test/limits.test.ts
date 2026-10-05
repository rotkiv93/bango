import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

async function city(options: ConstructorParameters<typeof Bango>[0]) {
  const { bango } = await openProject('city', new Bango(options));
  return bango;
}

describe('instances over the limit', () => {
  it('are kept, not parsed, and reported with the size and the limit', async () => {
    const bango = await city({ maxInstanceChars: 1000 });
    const big = 'datamodel big\n' + '// padding\n'.repeat(200);
    const state = await bango.setText('datamodel', big);
    expect(state.text).toBe(big);
    expect(state.ast).toBeUndefined();
    expect(state.available).toBe(true);
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0].message).toMatch(/million characters, over the limit of 0\.0 million: it is not read.*maxInstanceChars/);
    // what refers to it notices, the rest is untouched
    expect(errors((await bango.getInstance('gismodel')).problems).join()).toMatch(/Could not resolve/);
    const json = await bango.toJson('datamodel').catch(e => String(e));
    expect(json).toBeUndefined();
  });

  it('are back as soon as they are small enough, and a text exactly at the limit is read', async () => {
    const bango = await city({ maxInstanceChars: 1000 });
    const { project } = await openProject('city');
    await bango.setText('datamodel', 'x'.repeat(1001));
    expect((await bango.getInstance('datamodel')).ast).toBeUndefined();
    const fits = 'datamodel d\n' + '// '.padEnd(1000 - 'datamodel d\n'.length - 1, 'x') + '\n';
    expect(fits.length).toBe(1000);
    const exact = await bango.setText('datamodel', fits);
    expect(exact.ast).toBeDefined();
    const back = await bango.setText('datamodel', project.instances.datamodel);
    // this text is a few hundred characters: under the limit
    expect(project.instances.datamodel.length).toBeLessThan(1000);
    expect(errors(back.problems)).toEqual([]);
    expect(errors((await bango.getInstance('gismodel')).problems)).toEqual([]);
  });

  it('the default limit is two million characters, and a text over it is refused fast, without being parsed', async () => {
    const bango = await city({});
    const big = 'datamodel big\n' + '// padding padding padding padding padding\n'.repeat(52_000);
    expect(big.length).toBeGreaterThan(2_000_000);
    const started = performance.now();
    const state = await bango.setText('datamodel', big);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(state.ast).toBeUndefined();
    expect(state.problems[0].message).toMatch(/over the limit of 2\.0 million/);
  }, 30_000);

  it('an edit from a form on one of them says why it cannot, instead of failing obscurely', async () => {
    const bango = await city({ maxInstanceChars: 1000 });
    await bango.setText('datamodel', 'x'.repeat(1500));
    await expect(bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' })).rejects.toThrow();
  });
});

describe('grammars over the limit', () => {
  it('are not read, and the metamodel is unavailable with the reason', async () => {
    const seed = loadSeed();
    const bango = new Bango({ maxGrammarChars: 800 });
    await bango.setGrammar('common', seed.grammars.common);
    await bango.setGrammar('huge', seed.grammars.sensors);
    expect(seed.grammars.sensors.length).toBeGreaterThan(800);
    const huge = (await bango.listMetamodels()).find(g => g.name === 'huge')!;
    expect(huge.problems.map(p => p.message).join()).toMatch(/over the limit of 0\.0 million: it was not read/);
    expect(huge.extension).toBeUndefined();
    const check = await bango.checkSelection(['huge']);
    expect(check.ok).toBe(false);
    // a grammar that fits is fine next to it
    await bango.setGrammar('small', "grammar Small\nimport 'common'\nentry S: 's' name=ID;\n");
    expect((await bango.checkSelection(['small'])).ok).toBe(true);
  });

  it('the default limit is a million characters, and one over it is refused fast', async () => {
    const bango = new Bango();
    await bango.setGrammar('common', loadSeed().grammars.common);
    const text = "grammar Big\nimport 'common'\nentry B: 'b' name=ID;\n" + '// padding padding padding padding padding\n'.repeat(26_000);
    expect(text.length).toBeGreaterThan(1_000_000);
    await bango.setGrammar('big', text);
    const started = performance.now();
    const big = (await bango.listMetamodels()).find(g => g.name === 'big')!;
    expect(performance.now() - started).toBeLessThan(3000);
    expect(big.problems.map(p => p.message).join()).toMatch(/over the limit of 1\.0 million/);
  }, 30_000);
});

describe('input that is hard for a parser', () => {
  it('a nesting too deep for the parser is a problem of that instance, not a failed call', async () => {
    const { bango } = await openProject('portal');
    const nested = (depth: number) => 'menus portal\nmenu main {\n' + Array.from({ length: depth }, (_, i) => `item n${i} {`).join('\n') + '\nitem leaf opens Roads\n' + '}\n'.repeat(depth) + '}\n';

    // far deeper than any menu: the parser runs out of stack. The call answers, and says what happened
    const state = await bango.setText('menus', nested(20_000));
    expect(state.ast).toBeUndefined();
    expect(state.available).toBe(true);
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0].message).toMatch(/could not be read: it is nested too deeply/);

    // everything else is intact, and the instance is readable again as soon as the text is
    expect((await bango.getInstance('datamodel')).ast).toBeDefined();
    expect(errors((await bango.getInstance('forms')).problems)).toEqual([]);
    const fine = await bango.setText('menus', 'menus portal\nmenu main {\n  item a opens Roads\n}\n');
    expect(fine.ast).toBeDefined();
    expect(errors(fine.problems)).toEqual([]);
    expect((await bango.build('portal')).ok).toBe(true);
  }, 60_000);

  it('a deep but sane nesting is read', async () => {
    const { bango } = await openProject('portal');
    const depth = 40;
    const text = 'menus portal\nmenu main {\n' + Array.from({ length: depth }, (_, i) => `item n${i} {`).join('\n') + '\nitem leaf opens Roads\n' + '}\n'.repeat(depth) + '}\n';
    const state = await bango.setText('menus', text);
    expect(state.ast).toBeDefined();
    expect(state.problems.filter(p => /levels deep/.test(p.message)).length).toBeGreaterThan(0);
  }, 60_000);

  it('a long line, many tiny entities and unusual characters are read', async () => {
    const { bango } = await openProject('shop');
    const many = 'datamodel big\n' + Array.from({ length: 3000 }, (_, i) => `entity E${i} { property p: String pk }`).join('\n') + '\n';
    expect(errors((await bango.setText('datamodel', many)).problems)).toEqual([]);
    const oneLine = 'datamodel big ' + Array.from({ length: 500 }, (_, i) => `entity L${i} { property p: String pk }`).join(' ');
    expect(errors((await bango.setText('datamodel', oneLine)).problems)).toEqual([]);
    const odd = 'datamodel d\nentity Ünïcode { property p: String pk }\n';
    expect((await bango.setText('datamodel', odd)).problems.length).toBeGreaterThan(0);
    const tabs = 'datamodel d\r\nentity A {\r\n\tproperty p: String pk\r\n}\r\n';
    expect(errors((await bango.setText('datamodel', tabs)).problems)).toEqual([]);
  }, 60_000);
});
