import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { OTHER_GRAMMAR, OTHER_INSTANCE } from '../../../test-support/clash.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

const texts = async (bango: Bango) => Object.fromEntries((await bango.getInstances()).map(i => [i.metamodel, i.text]));
const grammarErrors = (info: { grammars: { name: string; problems: { severity: string; message: string }[] }[] }, name: string) =>
  info.grammars.find(g => g.name === name)!.problems.filter(p => p.severity === 'error').map(p => p.message);

describe('grammars changing under a running project', () => {
  it('breaking a grammar and repairing it changes nothing in the end', async () => {
    const { bango, seed } = await openProject('everything');
    const names = seed.projects.everything.metamodels;
    const textsBefore = await texts(bango);
    const jsonBefore = await bango.toProjectJson();

    for (const victim of ['security', 'menus', 'forms', 'gismodel', 'datamodel']) {
      await bango.setGrammar(victim, seed.grammars[victim] + '\nthis is not a grammar rule }}}\n');
      const broken = await bango.compose(names);
      // it does not throw, and says which grammar is wrong
      expect(grammarErrors(broken, victim).length, `${victim} is reported`).toBeGreaterThan(0);
      // the instance of the broken metamodel keeps working on the last version that compiled
      const state = await bango.getInstance(victim);
      expect(state.available, victim).toBe(true);
      expect(state.stale, victim).toBe(true);
      expect(state.text).toBe(textsBefore[victim]);

      await bango.setGrammar(victim, seed.grammars[victim]);
      await bango.compose(names);
      const state2 = await bango.getInstance(victim);
      expect(state2.stale, `${victim} recovered`).toBe(false);
      expect(await texts(bango), `${victim}: texts`).toEqual(textsBefore);
      for (const s of await bango.getInstances()) expect(errors(s.problems), `${victim} repaired: ${s.metamodel}`).toEqual([]);
      expect(await bango.toProjectJson(), `${victim}: json`).toEqual(jsonBefore);
    }
  }, 120_000);

  it('a metamodel that never compiled is unavailable with the reason, and its text is kept for when it does', async () => {
    const { bango } = await openProject('office');
    await bango.setGrammar('broken', "grammar Broken\nimport 'common'\nentry B: 'b' name=;\n");
    const info = await bango.compose(['datamodel', 'broken']);
    expect(info.languages.map(l => l.name)).toEqual(['datamodel']);
    await bango.setText('broken', 'b hello');
    const state = await bango.getInstance('broken');
    expect(state.available).toBe(false);
    expect(state.problems[0].message).toMatch(/has errors|fix it/);
    expect(state.text).toBe('b hello');

    await bango.setGrammar('broken', "grammar Broken\nimport 'common'\nentry B: 'b' name=ID;\n");
    await bango.compose(['datamodel', 'broken']);
    const fixed = await bango.getInstance('broken');
    expect(fixed.available).toBe(true);
    expect(errors(fixed.problems)).toEqual([]);
    expect(fixed.text).toBe('b hello');
  });

  it('removing a grammar that others import makes them unavailable, saying why; putting it back restores everything', async () => {
    const { bango, seed } = await openProject('office');
    const names = seed.projects.office.metamodels;
    const textsBefore = await texts(bango);
    const jsonBefore = await bango.toProjectJson();

    await bango.removeGrammar('datamodel');
    const info = await bango.compose(names);
    expect(info.problems.length + info.grammars.filter(g => g.problems.some(p => p.severity === 'error')).length).toBeGreaterThan(0);
    for (const m of names) {
      const state = await bango.getInstance(m);
      expect(state.text, m).toBe(textsBefore[m]);
    }

    await bango.setGrammar('datamodel', seed.grammars.datamodel);
    await bango.compose(names);
    expect(await texts(bango)).toEqual(textsBefore);
    for (const s of await bango.getInstances()) expect(errors(s.problems), s.metamodel).toEqual([]);
    expect(await bango.toProjectJson()).toEqual(jsonBefore);
  });

  it('a metamodel with a type name that clashes can join and leave a running project, and the others do not notice', async () => {
    const { bango, seed } = await openProject('everything');
    const names = seed.projects.everything.metamodels;
    const jsonBefore = await bango.toProjectJson();

    await bango.setGrammar('other', OTHER_GRAMMAR);
    const joined = await bango.compose([...names, 'other']);
    expect(joined.renames).toEqual([{ file: 'other', original: 'Entity', renamed: 'OtherEntity', keeper: 'datamodel' }]);
    await bango.setText('other', OTHER_INSTANCE);
    for (const s of await bango.getInstances()) expect(errors(s.problems), `with other: ${s.metamodel}`).toEqual([]);
    expect(await bango.toProjectJson()).toEqual(jsonBefore);

    // security's references to entities still resolve to the data model's entities, not to the other metamodel's
    const kinds = ((await bango.toJson('security')) as { data: { security: { permissions: { kind?: string }[] } } }).data.security.permissions.map(p => p.kind);
    expect(kinds).toContain('entity');

    const left = await bango.compose(names);
    expect(left.renames).toEqual([]);
    expect((await bango.getInstance('other')).available).toBe(false);
    for (const s of (await bango.getInstances()).filter(i => i.metamodel !== 'other')) expect(errors(s.problems), `without other: ${s.metamodel}`).toEqual([]);
  });

  it('a constraint that throws on every node is a problem of that instance, and no other instance changes', async () => {
    const { bango, seed } = await openProject('everything');
    const jsonBefore = await bango.toProjectJson();
    await bango.setConstraints('menus', "return { Menu() { throw new Error('menus constraint exploded'); }, MenuItem() { throw new Error('and so does this'); } };");
    await bango.compose(seed.projects.everything.metamodels);
    expect(errors((await bango.getInstance('menus')).problems).join()).toMatch(/exploded/);
    for (const s of (await bango.getInstances()).filter(i => i.metamodel !== 'menus')) expect(errors(s.problems), s.metamodel).toEqual([]);
    expect(await bango.toProjectJson()).toEqual(jsonBefore);
  });

  it('a JSON mapping that throws fails that metamodel only, with its name', async () => {
    const { bango, seed } = await openProject('office');
    await bango.setSpec('forms', "return function () { throw new Error('forms mapping exploded'); };");
    await bango.compose(seed.projects.office.metamodels);
    await expect(bango.toProjectJson()).rejects.toThrow(/JSON mapping of 'forms' failed: forms mapping exploded/);
    expect(await bango.toJson('datamodel')).toBeDefined();
    const build = await bango.build('office');
    expect(build.ok).toBe(false);
    expect(build.errors.join()).toMatch(/forms/);
  });
});

describe('unusual grammars', () => {
  it('two grammars that import each other do not hang, and are reported or composed without crashing', async () => {
    const bango = new Bango();
    await bango.setGrammar('common', loadSeed().grammars.common);
    await bango.setGrammar('ping', "grammar Ping\nimport 'common'\nimport 'pong'\nentry P: 'ping' name=ID;\n");
    await bango.setGrammar('pong', "grammar Pong\nimport 'common'\nimport 'ping'\nentry Q: 'pong' name=ID;\n");
    const info = await bango.compose(['ping']);
    expect(info.languages.length + info.problems.length + info.grammars.length).toBeGreaterThan(0);
    // asking again and asking for both still answers
    await bango.compose(['ping', 'pong']);
    expect((await bango.checkSelection(['ping'])).suggested.length).toBeGreaterThan(0);
  }, 30_000);

  it('importing a grammar that does not exist is a problem of the importer, not a crash', async () => {
    const bango = new Bango();
    await bango.setGrammar('common', loadSeed().grammars.common);
    await bango.setGrammar('lonely', "grammar Lonely\nimport 'common'\nimport 'ghost'\nentry L: 'l' name=ID;\n");
    const info = await bango.compose(['lonely']);
    const problems = info.grammars.find(g => g.name === 'lonely')!.problems.map(p => p.message).join();
    expect(problems.length).toBeGreaterThan(0);
  });

  it('a grammar with two entry rules, or none, is not silently accepted as a metamodel', async () => {
    const bango = new Bango();
    await bango.setGrammar('common', loadSeed().grammars.common);
    await bango.setGrammar('twins', "grammar Twins\nimport 'common'\nentry A: 'a' name=ID;\nentry B: 'b' name=ID;\n");
    await bango.setGrammar('nothing', "grammar Nothing\nimport 'common'\nX: 'x' name=ID;\n");
    const all = await bango.listMetamodels();
    expect(all.find(g => g.name === 'nothing')!.extension).toBeUndefined();
    expect(all.find(g => g.name === 'twins')!.problems.some(p => p.severity === 'error')).toBe(true);
    expect((await bango.checkSelection(['twins'])).ok).toBe(false);
    expect((await bango.checkSelection(['nothing'])).ok).toBe(false);
  });

  it('a grammar whose name is not its file name still composes under the file name', async () => {
    const bango = new Bango();
    await bango.setGrammar('common', loadSeed().grammars.common);
    await bango.setGrammar('shortname', "grammar SomethingElseEntirely\nimport 'common'\nentry M: 'm' name=ID;\n");
    const info = await bango.compose(['shortname']);
    expect(info.languages.map(l => l.name)).toEqual(['shortname']);
    expect(info.languages[0].extension).toBe('somethingelseentirely');
    await bango.setText('shortname', 'm hello');
    expect(errors((await bango.getInstance('shortname')).problems)).toEqual([]);
  });
});

describe('calls that overlap', () => {
  it('many calls in flight at once end in the same state as the same calls one after another', async () => {
    const seed = loadSeed();
    const make = async () => {
      const bango = new Bango();
      for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
      for (const [n, c] of Object.entries(seed.constraints)) await bango.setConstraints(n, c);
      for (const [n, c] of Object.entries(seed.specs)) await bango.setSpec(n, c);
      return bango;
    };
    const office = seed.projects.office;
    const script = (bango: Bango) => [
      () => bango.compose(['datamodel']),
      () => bango.setText('datamodel', office.instances.datamodel),
      () => bango.compose(['datamodel', 'forms']),
      () => bango.setText('forms', office.instances.forms),
      () => bango.compose(['datamodel', 'forms', 'lists']),
      () => bango.setText('lists', office.instances.lists),
      () => bango.setText('datamodel', office.instances.datamodel.replace('Customer display', 'Client display')),
      () => bango.compose(office.metamodels),
      () => bango.setText('security', office.instances.security),
      () => bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'edited' }),
      () => bango.compose(office.metamodels)
    ];

    const sequential = await make();
    for (const call of script(sequential)) await call();
    const concurrent = await make();
    const results = await Promise.allSettled(script(concurrent).map(call => call()));
    expect(results.filter(r => r.status === 'rejected')).toEqual([]);

    expect(await texts(concurrent)).toEqual(await texts(sequential));
    expect((await concurrent.getComposition())!.selection).toEqual((await sequential.getComposition())!.selection);
    expect(await concurrent.toProjectJson()).toEqual(await sequential.toProjectJson());
    for (const s of await concurrent.getInstances()) {
      expect(s.problems.map(p => p.message), s.metamodel).toEqual((await sequential.getInstance(s.metamodel)).problems.map(p => p.message));
    }
  });

  it('text set for a metamodel that is not in the project yet is kept, and checked once it joins', async () => {
    const { bango, project } = await openProject('office');
    await bango.compose(['datamodel']);
    const early = await bango.getInstance('forms');
    expect(early.available).toBe(false);
    expect(early.text).toBe(project.instances.forms);
    await bango.compose(['datamodel', 'forms']);
    const joined = await bango.getInstance('forms');
    expect(joined.available).toBe(true);
    expect(errors(joined.problems)).toEqual([]);
  });
});
