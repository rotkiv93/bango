import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { OTHER_GRAMMAR, OTHER_INSTANCE } from '../../../test-support/clash.js';
import { errors, openProject, warnings } from '../../../test-support/harness.js';

/** The city project (datamodel + gismodel) plus a metamodel that also calls its things Entity. */
async function withOther(extraConstraints?: string, spec?: string) {
  const opened = await openProject('city');
  const { bango } = opened;
  await bango.setGrammar('other', OTHER_GRAMMAR);
  if (extraConstraints) await bango.setConstraints('other', extraConstraints);
  if (spec) await bango.setSpec('other', spec);
  const info = await bango.compose(['datamodel', 'gismodel', 'other']);
  await bango.setText('other', OTHER_INSTANCE);
  return { ...opened, info };
}

describe('instances of metamodels whose type names clash', () => {
  it('both parse and validate, each with its own types', async () => {
    const { bango, project } = await withOther();
    expect(errors((await bango.getInstance('other')).problems)).toEqual([]);
    expect(errors((await bango.getInstance('datamodel')).problems)).toEqual([]);
    expect(errors((await bango.getInstance('gismodel')).problems)).toEqual([]);

    const other = (await bango.getInstance('other')).ast!;
    expect(other.type).toBe('Top');
    expect((other.children.items as { type: string }[]).map(i => i.type)).toEqual(['OtherEntity', 'OtherEntity']);
    const datamodel = (await bango.getInstance('datamodel')).ast!;
    expect((datamodel.children.entities as { type: string }[])[0].type).toBe('Entity');
    expect(project.instances.datamodel).toContain('entity Road');
  });

  it('the composition reports the rename', async () => {
    const { bango, info } = await withOther();
    expect(info.renames).toEqual([{ file: 'other', original: 'Entity', renamed: 'OtherEntity', keeper: 'datamodel' }]);
    expect((await bango.getComposition())!.renames).toEqual(info.renames);
  });

  it('references never reach into the other metamodel, even for the same name', async () => {
    const { bango, project } = await withOther();
    // `Foo` exists only in `other`: a layer of the GIS model cannot show it, although both call their things Entity
    const gis = project.instances.gismodel.replace('entity Road', 'entity Foo');
    expect(errors((await bango.setText('gismodel', gis)).problems).join('\n')).toMatch(/Could not resolve reference to Entity named 'Foo'/);
    // ... and a link in `other` cannot point at an entity of the data model
    const link = await bango.setText('other', OTHER_INSTANCE.replace('link Foo', 'link Road'));
    expect(errors(link.problems).join('\n')).toMatch(/Could not resolve reference to OtherEntity named 'Road'/);
  });

  it('the same name in both metamodels is no conflict', async () => {
    const { bango, project } = await withOther();
    await bango.setText('other', 'other x\ne Road\nlink Road');
    expect(errors((await bango.getInstance('other')).problems)).toEqual([]);
    expect(errors((await bango.getInstance('gismodel')).problems)).toEqual([]);
    expect(project.instances.datamodel).toContain('entity Road');
  });

  it('constraints written against the original name apply to the renamed type only', async () => {
    const constraints = `return { Entity(node, accept) { accept('warning', 'checked a ' + typeName(node), { node, property: 'name' }); } };`;
    const { bango } = await withOther(constraints);
    const found = warnings((await bango.getInstance('other')).problems);
    expect(found).toEqual(['checked a Entity', 'checked a Entity']);
    // the data model's own Entity is not touched by the constraints of `other`
    expect((await bango.getInstance('datamodel')).problems.filter(p => p.message.startsWith('checked'))).toEqual([]);
  });

  it('the constraints of a metamodel keep working next to a renamed one', async () => {
    const { bango, project } = await withOther();
    // the data model's duplicate-field rule is keyed by `Entity`: it still sees the data model's entities
    const s = await bango.setText('datamodel', project.instances.datamodel.replace('property lanes: Integer', 'property name: String'));
    expect(errors(s.problems).join('\n')).toMatch(/duplicate field 'name'/);
  });

  it('a JSON mapping can ask for the original type name', async () => {
    const { bango } = await withOther(undefined, 'return function (model) { return { types: model.items.map(i => typeName(i)), raw: model.items.map(i => i.$type) }; };');
    expect(await bango.toJson('other')).toEqual({ types: ['Entity', 'Entity'], raw: ['OtherEntity', 'OtherEntity'] });
  });

  it('forms and edits use the names of the composition', async () => {
    const { bango } = await withOther();
    const schema = (await bango.getFormSchema('other'))!;
    expect(Object.keys(schema.types)).toEqual(expect.arrayContaining(['Top', 'OtherEntity', 'Link']));
    expect(schema.types.Top.fields.find(f => f.name === 'items')!.childTypes).toEqual(['OtherEntity']);
    expect(schema.types.Link.fields.find(f => f.name === 'target')).toMatchObject({ kind: 'ref', refType: 'OtherEntity' });

    const added = await bango.applyEdit('other', { kind: 'add', path: [], feature: 'items', type: 'OtherEntity' });
    expect(added.text).toContain('e newOtherEntity');
    expect(errors(added.problems)).toEqual([]);
    const candidates = await bango.getRefCandidates('OtherEntity');
    expect(candidates.map(c => c.name).sort()).toEqual(['Bar', 'Foo', 'newOtherEntity']);
    expect(new Set(candidates.map(c => c.metamodel))).toEqual(new Set(['other']));
  });

  it('completion offers only what the reference can point at', async () => {
    const { bango } = await withOther();
    const text = 'other t\ne Foo\nlink ';
    const labels = (await bango.complete('other', text, 2, 5)).map(i => i.label);
    expect(labels).toContain('Foo');
    expect(labels).not.toContain('Road');
    const gisText = 'gismodel\ngeojsonlayer l entity ';
    expect((await bango.complete('gismodel', gisText, 1, 'geojsonlayer l entity '.length)).map(i => i.label)).not.toContain('Foo');
  });

  it('the project builds, and the generic JSON shows the new names', async () => {
    const { bango } = await withOther();
    const result = await bango.build('mix');
    expect(result.ok, result.errors.join('\n')).toBe(true);
    const generic = (await bango.toJson('other', { format: 'generic' })) as { items: { $type: string }[] };
    expect(generic.items.map(i => i.$type)).toEqual(['OtherEntity', 'OtherEntity']);
  });

  it('without the other metamodel nothing is renamed', async () => {
    const { bango } = await openProject('city');
    await bango.setGrammar('other', OTHER_GRAMMAR);
    expect((await bango.compose(['datamodel', 'gismodel'])).renames).toEqual([]);
    const alone = await new Bango().compose(['x']).catch(() => undefined);
    expect(alone).toBeDefined();
  });
});
