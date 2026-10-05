import { describe, expect, it } from 'vitest';
import { ModelComposer } from '../src/index.js';
import { OTHER_GRAMMAR, SHARED_A, SHARED_B, USES_GRAMMAR } from '../../../test-support/clash.js';
import { loadSeed } from '../../../test-support/seed.js';

function composerWith(extra: Record<string, string> = {}) {
  const seed = loadSeed();
  const composer = new ModelComposer();
  for (const [name, text] of Object.entries({ ...seed.grammars, ...extra })) composer.setGrammar(name, text);
  for (const [name, code] of Object.entries(seed.constraints)) composer.setConstraints(name, code);
  return { composer, seed };
}

const infos = (c: { grammars: { name: string; problems: { severity: string; message: string }[] }[] }, name: string) =>
  c.grammars.find(g => g.name === name)!.problems.filter(p => p.severity === 'info').map(p => p.message);
const typeNames = (g: { rules: { $type: string; name?: string }[] }) => g.rules.filter(r => r.$type === 'ParserRule').map(r => r.name);

describe('type name clashes between metamodels', () => {
  it('the shipped metamodels do not clash: nothing is renamed', async () => {
    const { composer } = composerWith();
    const c = await composer.compose();
    expect(c.renames).toEqual([]);
    expect(c.info().renames).toEqual([]);
    for (const g of c.grammars) expect(infos(c, g.name)).toEqual([]);
  });

  it('two metamodels that declare the same type: the one that others use keeps the name, the other is renamed', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'gismodel', 'other']);
    expect(c.renames).toEqual([{ file: 'other', original: 'Entity', renamed: 'OtherEntity', keeper: 'datamodel' }]);
    expect(c.info().renames).toEqual(c.renames);
  });

  it('the grammars of the composition use the new name everywhere, and only the clashing one changes', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'other']);
    expect(typeNames(c.get('other')!.grammar)).toEqual(expect.arrayContaining(['Top', 'OtherEntity', 'Link']));
    expect(typeNames(c.get('other')!.grammar)).not.toContain('Entity');
    expect(typeNames(c.get('datamodel')!.grammar)).toContain('Entity');
    expect(c.get('other')!.grammar.rules.map(r => r.$type === 'ParserRule' ? r.name : '')).not.toContain('Entity');
  });

  it('the merged reflection has both types, each with its own properties', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'other']);
    const props = (type: string) => Object.keys(c.reflection.getTypeMetaData(type).properties);
    expect(props('Entity')).toContain('fields');
    expect(props('Entity')).not.toContain('note');
    expect(props('OtherEntity')).toContain('note');
    expect(props('OtherEntity')).not.toContain('fields');
    expect(c.reflection.getReferenceType({ container: { $type: 'Link' } as never, property: 'target', reference: undefined as never })).toBe('OtherEntity');
  });

  it('says so on the grammar that was renamed, and not on the one that keeps its name', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'other']);
    expect(infos(c, 'other')).toEqual(["Type 'Entity' is also declared by 'datamodel': in a project that uses both it is called 'OtherEntity'"]);
    expect(infos(c, 'datamodel')).toEqual([]);
    // it is information, not an error: both metamodels stay usable
    expect(c.ok).toBe(true);
  });

  it('only matters for the metamodels that are in the project together', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    expect((await composer.compose(['other'])).renames).toEqual([]);
    expect((await composer.compose(['datamodel', 'gismodel'])).renames).toEqual([]);
    // alone, the grammar keeps the name it was written with
    expect(typeNames((await composer.compose(['other'])).get('other')!.grammar)).toContain('Entity');
  });

  it('the name stays with the grammar that most metamodels of the project include', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR, uses: USES_GRAMMAR });
    // datamodel is included by one metamodel, other by two (itself and uses): other keeps Entity
    const c = await composer.compose(['datamodel', 'other', 'uses']);
    expect(c.renames).toEqual([{ file: 'datamodel', original: 'Entity', renamed: 'DatamodelEntity', keeper: 'other' }]);
  });

  it('a metamodel that imports a renamed grammar has its references to it rewritten', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR, uses: USES_GRAMMAR });
    // datamodel and other are used equally; the tie goes to the first by name, so other is renamed
    const c = await composer.compose(['datamodel', 'gismodel', 'other', 'uses']);
    expect(c.renames.map(r => `${r.file}:${r.original}->${r.renamed}`)).toEqual(['other:Entity->OtherEntity']);
    expect(c.bundleText('uses')).toContain('[OtherEntity:ID]');
    expect(c.bundleText('uses')).not.toContain('[Entity:ID]');
  });

  it('the grammars the user sees are the ones they wrote, with their positions', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'other']);
    expect(JSON.stringify(c.grammarAst('other'))).toContain('"name":"Entity"');
    expect(JSON.stringify(c.grammarAst('other'))).not.toContain('OtherEntity');
    expect((await composer.metamodels()).find(g => g.name === 'other')!.problems).toEqual([]);
  });

  it('a new name never clashes with another one', async () => {
    const taken = OTHER_GRAMMAR.replace('Link: ', 'OtherEntity: \'x\' name=ID;\nLink: ').replace('links+=Link)*', 'links+=Link | more+=OtherEntity)*');
    const { composer } = composerWith({ other: taken });
    const c = await composer.compose(['datamodel', 'other']);
    expect(c.renames.map(r => r.renamed)).toEqual(['OtherEntity2']);
    expect(typeNames(c.get('other')!.grammar)).toEqual(expect.arrayContaining(['Top', 'OtherEntity2', 'OtherEntity', 'Link']));
  });

  it('interfaces clash too, and the rules that return them follow', async () => {
    const { composer } = composerWith({ sharedA: SHARED_A, sharedB: SHARED_B });
    const c = await composer.compose(['sharedA', 'sharedB']);
    expect(c.renames).toEqual([{ file: 'sharedB', original: 'Shared', renamed: 'SharedBShared', keeper: 'sharedA' }]);
    expect(c.bundleText('sharedB')).toContain('interface SharedBShared');
    expect(c.bundleText('sharedB')).toContain('ThingB returns SharedBShared');
    expect(c.bundleText('sharedA')).toContain('interface Shared ');
    expect(c.ok).toBe(true);
  });

  it('the original name of a type is available to scripts', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    const c = await composer.compose(['datamodel', 'other']);
    expect(c.typeName({ $type: 'OtherEntity' })).toBe('Entity');
    expect(c.typeName({ $type: 'Entity' })).toBe('Entity');
    expect(c.typeName({ $type: 'Top' })).toBe('Top');
    expect(c.typeName(undefined)).toBeUndefined();
  });

  it('editing a grammar updates the plan', async () => {
    const { composer } = composerWith({ other: OTHER_GRAMMAR });
    expect((await composer.compose(['datamodel', 'other'])).renames).toHaveLength(1);
    composer.setGrammar('other', OTHER_GRAMMAR.replace(/Entity/g, 'Item'));
    const c = await composer.compose(['datamodel', 'other']);
    expect(c.renames).toEqual([]);
    expect(typeNames(c.get('other')!.grammar)).toContain('Item');
  });
});
