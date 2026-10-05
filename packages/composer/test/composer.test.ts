import { describe, expect, it } from 'vitest';
import { ModelComposer } from '../src/index.js';
import { loadSeed } from '../../../test-support/seed.js';

const errors = (ps: { severity: string; message: string }[]) => ps.filter(p => p.severity === 'error').map(p => p.message);

function composerWith(overrides: Record<string, string> = {}) {
  const seed = loadSeed();
  const composer = new ModelComposer();
  for (const [name, text] of Object.entries({ ...seed.grammars, ...overrides })) composer.setGrammar(name, text);
  for (const [name, code] of Object.entries(seed.constraints)) composer.setConstraints(name, code);
  return { composer, seed };
}

describe('ModelComposer', () => {
  it('compiles the seed grammars; libraries are not metamodels', async () => {
    const { composer } = composerWith();
    const c = await composer.compose();
    for (const g of c.grammars) expect(errors(g.problems), g.name).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.grammars.find(g => g.name === 'common')!.extension).toBeUndefined();
    expect(c.metamodels.map(m => m.name).sort()).toEqual(['app', 'datamodel', 'mapviewer', 'sensors']);
    expect(c.get('mapviewer')!.extension).toBe('mapviewer');
  });

  it('requirements come from imports and are transitive', async () => {
    const { composer } = composerWith();
    const c = await composer.compose();
    const requires = (n: string) => [...c.grammars.find(g => g.name === n)!.requires].sort();
    expect(requires('datamodel')).toEqual([]);
    expect(requires('mapviewer')).toEqual(['datamodel']);
    expect(requires('app')).toEqual(['datamodel', 'mapviewer']);
    expect(requires('sensors')).toEqual(['datamodel', 'mapviewer']);
  });

  it('a metamodel without its dependency is blocked with an actionable message', async () => {
    const { composer } = composerWith();
    const c = await composer.compose(['mapviewer']);
    expect(c.ok).toBe(false);
    expect(c.problems).toEqual([
      { metamodel: 'mapviewer', missing: 'datamodel', message: "'mapviewer' needs 'datamodel': add 'datamodel' to this project" }
    ]);
    expect(c.get('mapviewer')).toBeUndefined();
    expect(c.explainUnavailable('mapviewer')).toMatch(/needs 'datamodel'/);
  });

  it('only the selected metamodels become languages', async () => {
    const { composer } = composerWith();
    const c = await composer.compose(['datamodel']);
    expect(c.ok).toBe(true);
    expect(c.metamodels.map(m => m.name)).toEqual(['datamodel']);
    expect(c.explainUnavailable('mapviewer')).toMatch(/not part of this project/);
    expect(c.explainUnavailable('nope')).toMatch(/No metamodel named/);
    expect(c.info().languages[0].keywords).toContain('entity');
  });

  it('selecting an unknown metamodel is a problem', async () => {
    const { composer } = composerWith();
    const c = await composer.compose(['datamodel', 'ghost']);
    expect(c.ok).toBe(false);
    expect(c.problems[0].message).toMatch(/ghost/);
  });

  it('the merged reflection knows the types of every selected metamodel', async () => {
    const { composer } = composerWith();
    const c = await composer.compose(['datamodel', 'mapviewer']);
    const types = c.reflection.getAllTypes();
    expect(types).toContain('Entity');
    expect(types).toContain('GeoJsonLayer');
    expect(c.reflection.isSubtype('GeoJsonLayer', 'Layer')).toBe(true);
  });

  it('a broken grammar reports errors, keeps serving the last good version and flags it stale', async () => {
    const { composer, seed } = composerWith();
    expect((await composer.compose(['datamodel'])).get('datamodel')!.stale).toBe(false);

    composer.setGrammar('datamodel', seed.grammars.datamodel.replace('Entity:', 'Thing:'));
    const c = await composer.compose(['datamodel']);
    expect(errors(c.grammars.find(g => g.name === 'datamodel')!.problems).length).toBeGreaterThan(0);
    expect(c.ok).toBe(false);
    expect(c.get('datamodel')!.stale).toBe(true);
  });

  it('a broken grammar that never compiled is unavailable', async () => {
    const { composer } = composerWith({ datamodel: 'grammar DataModel\nentry Model: oops' });
    const c = await composer.compose(['datamodel']);
    expect(c.get('datamodel')).toBeUndefined();
    expect(c.explainUnavailable('datamodel')).toMatch(/has errors/);
  });

  it('warns when two metamodels declare the same rule', async () => {
    const { composer } = composerWith({
      other: "grammar Other\nimport 'common'\nentry Top: 'other' items+=Entity*;\nEntity: 'e' name=ID;"
    });
    const c = await composer.compose();
    const warnings = c.grammars.find(g => g.name === 'other')!.problems.filter(p => p.severity === 'warning');
    expect(warnings.map(w => w.message).join()).toMatch(/Rule 'Entity' is also declared in/);
  });

  it('two grammars with the same name would share an extension: both are errors', async () => {
    const { composer } = composerWith({ datamodel2: 'grammar DataModel\nimport \'common\'\nentry M: \'x\' name=ID;' });
    const c = await composer.compose();
    expect(errors(c.grammars.find(g => g.name === 'datamodel2')!.problems).join()).toMatch(/Extension '.datamodel'/);
  });

  it('reports invalid constraint code on its metamodel and still composes it', async () => {
    const { composer } = composerWith();
    composer.setConstraints('datamodel', 'return { Entity( {');
    const c = await composer.compose(['datamodel']);
    expect(errors(c.grammars.find(g => g.name === 'datamodel')!.problems).join()).toMatch(/datamodel\.constraints\.js/);
    expect(c.get('datamodel')!.constraints).toEqual([]);
  });

  it('constraints of every source reach a composite metamodel', async () => {
    const { composer } = composerWith();
    const c = await composer.compose();
    const app = c.get('app')!;
    expect(app.sources.sort()).toEqual(['app', 'common', 'datamodel', 'mapviewer']);
    expect(app.constraints.flatMap(s => Object.keys(s)).sort()).toEqual(['Entity', 'GeoJsonLayer', 'MapDef', 'MapInLayerAndStyle', 'RelationshipField', 'StyleInterval']);
  });

  it('bundleText yields one self-contained grammar that compiles on its own', async () => {
    const { composer } = composerWith();
    const c = await composer.compose();
    const text = c.bundleText('mapviewer');
    expect(text).toMatch(/^grammar MapViewer/);
    expect(text).not.toMatch(/^import /m);

    const alone = new ModelComposer().setGrammar('bundle', text);
    const solo = await alone.compose();
    expect(errors(solo.grammars[0].problems)).toEqual([]);
    expect(solo.metamodels[0].extension).toBe('mapviewer');
    expect(solo.reflection.getAllTypes()).toContain('Entity');
  });

  it('info() is plain JSON', async () => {
    const { composer } = composerWith();
    const info = (await composer.compose(['datamodel', 'mapviewer'])).info();
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });
});

describe('selection check and catalogue', () => {
  it('a valid selection can become a project', async () => {
    const { composer } = composerWith();
    const check = await composer.check(['datamodel', 'mapviewer']);
    expect(check).toEqual({ ok: true, errors: [], problems: [], suggested: ['datamodel', 'mapviewer'] });
  });

  it('an empty selection cannot', async () => {
    const { composer } = composerWith();
    const check = await composer.check([]);
    expect(check.ok).toBe(false);
    expect(check.errors).toEqual(['Select at least one metamodel']);
  });

  it('a metamodel without what it needs cannot, and the check says what to add', async () => {
    const { composer } = composerWith();
    const check = await composer.check(['sensors']);
    expect(check.ok).toBe(false);
    expect(check.errors).toEqual([
      "'sensors' needs 'datamodel': add 'datamodel' to this project",
      "'sensors' needs 'mapviewer': add 'mapviewer' to this project"
    ]);
    expect(check.suggested).toEqual(['sensors', 'datamodel', 'mapviewer']);
    // following the suggestion makes it valid
    expect((await composer.check(check.suggested)).ok).toBe(true);
  });

  it('a selection with a metamodel that does not exist cannot', async () => {
    const { composer } = composerWith();
    const check = await composer.check(['datamodel', 'ghost']);
    expect(check.ok).toBe(false);
    expect(check.errors.join()).toMatch(/ghost/);
  });

  it('a selected metamodel with grammar errors cannot, and says where', async () => {
    const { composer } = composerWith({ datamodel: 'grammar DataModel\nentry Model: oops' });
    const check = await composer.check(['datamodel']);
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toMatch(/'datamodel' has errors in its grammar \(\d+:\d+ /);
  });

  it('checking does not depend on or change anything else: duplicates are ignored', async () => {
    const { composer } = composerWith();
    expect((await composer.check(['datamodel', 'datamodel'])).suggested).toEqual(['datamodel']);
  });

  it('lists every grammar with a one-line description, libraries included', async () => {
    const { composer } = composerWith();
    const all = await composer.metamodels();
    expect(all.map(g => g.name).sort()).toEqual(['app', 'common', 'datamodel', 'mapviewer', 'sensors']);
    expect(all.find(g => g.name === 'datamodel')!.description).toMatch(/^Data model:/);
    expect(all.find(g => g.name === 'sensors')!.description).toMatch(/^Sensors:/);
    expect(all.find(g => g.name === 'common')!.extension).toBeUndefined();
  });
});
