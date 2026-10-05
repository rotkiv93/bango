import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

async function bangoWithSeed() {
  const seed = loadSeed();
  const bango = new Bango();
  for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
  for (const [n, c] of Object.entries(seed.constraints)) await bango.setConstraints(n, c);
  for (const [n, c] of Object.entries(seed.specs)) await bango.setSpec(n, c);
  return { bango, seed };
}

describe('metamodel test cases', () => {
  it('every case shipped with the metamodels passes', async () => {
    const { bango, seed } = await bangoWithSeed();
    const names = Object.keys(seed.cases);
    expect(names.sort()).toEqual(['datamodel', 'forms', 'gismodel', 'lists']);
    for (const name of names) {
      const results = await bango.runCases(name, seed.cases[name]);
      expect(results.length).toBe(seed.cases[name].length);
      for (const r of results) expect(r.failures, `${name}: ${r.name}`).toEqual([]);
    }
  });

  it('a case fails when an expected error is missing, or an unexpected one shows up', async () => {
    const { bango } = await bangoWithSeed();
    const valid = 'datamodel d\nentity Road {\n  property name: String pk\n}\n';
    const dup = 'datamodel d\nentity Road {\n  property name: String pk\n  property name: String\n}\n';
    const [missing, unexpected, matched, partial] = await bango.runCases('datamodel', [
      { name: 'expects an error that does not happen', text: valid, expect: { errors: ['duplicate field'] } },
      { name: 'does not expect the error that happens', text: dup, expect: {} },
      { name: 'expects the error that happens', text: dup, expect: { errors: ['duplicate field \'name\''] } },
      { name: 'matches by a piece of the message', text: dup, expect: { errors: ['duplicate'] } }
    ]);
    expect(missing.ok).toBe(false);
    expect(missing.failures).toEqual(['expected error containing "duplicate field", but there is none']);
    expect(unexpected.ok).toBe(false);
    expect(unexpected.failures).toEqual(["unexpected error: duplicate field 'name'"]);
    expect(unexpected.problems.some(p => p.severity === 'error')).toBe(true);
    expect(matched.ok).toBe(true);
    expect(partial.ok).toBe(true);
  });

  it('warnings are only checked when the case lists them', async () => {
    const { bango } = await bangoWithSeed();
    const noPk = 'datamodel d\nentity Road {\n  property name: String\n}\n';
    const [ignored, listed, wrong] = await bango.runCases('datamodel', [
      { name: 'warnings not listed', text: noPk, expect: {} },
      { name: 'warnings listed', text: noPk, expect: { warnings: ['pk property'] } },
      { name: 'no warnings expected', text: noPk, expect: { warnings: [] } }
    ]);
    expect(ignored.ok).toBe(true);
    expect(listed.ok).toBe(true);
    expect(wrong.ok).toBe(false);
    expect(wrong.failures[0]).toMatch(/^unexpected warning: entity 'Road' should have exactly one pk/);
  });

  it('a metamodel runs with the metamodels it requires, whose samples come with the case', async () => {
    const { bango } = await bangoWithSeed();
    const [ok, bad] = await bango.runCases('gismodel', [
      { name: 'without the data it needs', text: 'gismodel\ngeojsonlayer l entity Road defaultStyle s availableStyles s\n', expect: { errors: [] } },
      {
        name: 'with it',
        with: { datamodel: 'datamodel d\nentity Road {\n  property name: String pk\n  property geometry: LineString\n}\n' },
        text: 'gismodel\ngeojsonstyle s fillColor "#fff" strokeColor "#000" fillOpacity 0.5 strokeOpacity 1.0 radius 2.0\ngeojsonlayer l entity Road defaultStyle s availableStyles s\n',
        expect: { errors: [] }
      }
    ]);
    // the first has no data model, so `Road` cannot resolve
    expect(ok.ok).toBe(false);
    expect(ok.failures.join()).toMatch(/Road/);
    expect(bad.ok).toBe(true);
  });

  it('does not disturb the composition or the instances being worked on', async () => {
    const { bango, project } = await openProject('city');
    const before = await bango.getInstances();
    const info = await bango.getComposition();
    await bango.runCases('forms', [{ name: 'x', with: { datamodel: 'datamodel d\nentity P {\n  property n: String pk\n}\n' }, text: 'forms\nform F entity P\n', expect: {} }]);
    expect(await bango.getInstances()).toEqual(before);
    expect(await bango.getComposition()).toEqual(info);
    expect((await bango.getInstance('gismodel')).text).toBe(project.instances.gismodel);
  });

  it('a grammar with errors fails every case with the reason', async () => {
    const { bango } = await bangoWithSeed();
    await bango.setGrammar('broken', "grammar Broken\nentry X: 'x' name=;\n");
    const results = await bango.runCases('broken', [{ name: 'a', text: 'x', expect: {} }, { name: 'b', text: 'x y', expect: {} }]);
    expect(results.map(r => r.ok)).toEqual([false, false]);
    expect(results[0].failures[0]).toMatch(/errors/);
  });

  it('cases and results are plain data', async () => {
    const { bango } = await bangoWithSeed();
    const cases = [{ name: 'a valid entity', text: 'datamodel d\nentity R {\n  property n: String pk\n}\n', expect: { errors: [] as string[] } }];
    expect(JSON.parse(JSON.stringify(await bango.runCases('datamodel', cases)))).toMatchObject([{ name: 'a valid entity', ok: true }]);
  });
});
