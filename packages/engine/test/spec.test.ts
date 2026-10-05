import { describe, expect, it } from 'vitest';
import { mergeJson, type JsonValue } from '../src/index.js';
import { COMBO_GRAMMAR, COMBO_INSTANCE } from '../../../test-support/combo.js';
import { errors, openProject } from '../../../test-support/harness.js';

type Obj = { [key: string]: JsonValue };

describe('the product specification (gresint)', () => {
  it('the specs of the four metamodels, merged, are the given JSON', async () => {
    const { bango, seed } = await openProject('gresint');
    expect(await bango.toProjectJson()).toEqual(seed.expected.gresint);
  });

  it('...down to the order of every key, so the text is identical too', async () => {
    const { bango, seed } = await openProject('gresint');
    expect(JSON.stringify(await bango.toProjectJson(), null, 2)).toBe(JSON.stringify(seed.expected.gresint, null, 2));
  });

  it('each metamodel contributes only its own part', async () => {
    const { bango } = await openProject('gresint');
    const datamodel = (await bango.toJson('datamodel')) as Obj;
    expect(Object.keys(datamodel)).toEqual(['data']);
    expect(Object.keys(datamodel.data as Obj)).toEqual(['dataModel']);
    expect(Object.keys((datamodel.data as Obj).dataModel as Obj)).toEqual(['entities', 'enums']);

    const gismodel = (await bango.toJson('gismodel')) as Obj;
    expect(Object.keys(gismodel.data as Obj)).toEqual(['mapViewer']);
    expect(Object.keys((gismodel.data as Obj).mapViewer as Obj)).toEqual(['maps', 'layers', 'styles']);

    const sensors = (await bango.toJson('sensors')) as Obj;
    expect(Object.keys(sensors)).toEqual(['data']);
    expect(Object.keys(sensors.data as Obj)).toEqual(['dataWarehouse']);
    expect(Object.keys((sensors.data as Obj).dataWarehouse as Obj)).toEqual(['sensors', 'sensorGroups']);
  });

  it('basic is the root: it owns the features and the basic data, and lays out the whole document', async () => {
    const { bango } = await openProject('gresint');
    const basic = (await bango.toJson('basic')) as Obj;
    expect(Object.keys(basic)).toEqual(['features', 'data']);
    expect(Object.keys(basic.data as Obj)).toEqual(['basicData', 'dataModel', 'dataWarehouse', 'forms', 'lists', 'menus', 'mapViewer', 'statics']);
    // the slots of the other metamodels are empty: they are theirs to fill
    expect((basic.data as Obj).dataModel).toEqual({});
    expect((basic.data as Obj).dataWarehouse).toEqual({});
    expect((basic.data as Obj).mapViewer).toEqual({});
    expect((basic.data as Obj).forms).toEqual([]);
    expect(((basic.data as Obj).basicData as Obj).name).toBe('gresint');
  });

  it('merging does not depend on the order of the parts, only the key order does', async () => {
    const { bango, seed } = await openProject('gresint');
    const parts = await Promise.all(['basic', 'datamodel', 'gismodel', 'sensors'].map(m => bango.toJson(m) as Promise<JsonValue>));
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1]]) {
      expect(mergeJson(...order.map(i => parts[i]))).toEqual(seed.expected.gresint);
    }
  });

  it('the key order is the root\'s whatever the order of the instances', async () => {
    const { bango, seed } = await openProject('gresint');
    // the same instances, set in the opposite order
    const states = (await bango.getInstances()).reverse();
    await bango.setInstances(Object.fromEntries(states.map(s => [s.metamodel, s.text])));
    expect(JSON.stringify(await bango.toProjectJson())).toBe(JSON.stringify(seed.expected.gresint));
  });

  it('describes the pieces the way the specification expects them', async () => {
    const { bango } = await openProject('gresint');
    const spec = (await bango.toProjectJson()) as { data: Obj };
    const entities = ((spec.data.dataModel as Obj).entities as Obj[]);
    const zone = entities.find(e => e.name === 'ZoneDimension')!;
    expect((zone.properties as Obj[])[0]).toEqual({ name: 'id', class: 'Long (autoinc)', pk: true, required: true, unique: true });
    expect((zone.properties as Obj[])[3]).toEqual({ name: 'StationObservationEntity', class: 'StationObservationEntity', owner: false, bidirectional: 'zonedimension_id', multiple: true, required: false });

    const layers = (spec.data.mapViewer as Obj).layers as Obj[];
    expect(layers.find(l => l.name === 'ZoneDimension')!.entityName).toBe('ZoneDimension-geometry');
    const styles = (spec.data.mapViewer as Obj).styles as Obj[];
    expect((styles.find(s => s.name === 'value')!.intervals as Obj[])[0]).toEqual({ minValue: '-Infinity', maxValue: 20, style: 'greenPoint' });

    const sensor = ((spec.data.dataWarehouse as Obj).sensors as Obj[])[0];
    expect(sensor).toMatchObject({ id: 'StationObservation', time: 10, isMoving: false, geom: 'Polygon', factTableEntity: 'StationObservationMeasurement' });
    expect(sensor.dimensions).toEqual([
      { id: 'ZoneDimension', type: 'SPATIAL', entities: ['ZoneDimension'] },
      { id: 'SensorType', type: 'CATEGORICAL', field: 'sensorType' }
    ]);
  });

  it('follows edits: change a name in the text and the project JSON changes', async () => {
    const { bango, project } = await openProject('gresint');
    await bango.setText('datamodel', project.instances.datamodel.replace('entity ZoneDimension display', 'entity Zone display'));
    const spec = (await bango.toProjectJson()) as { data: Obj };
    expect(((spec.data.dataModel as Obj).entities as Obj[])[0].name).toBe('Zone');
    // and the instances that point at it say so
    expect(errors((await bango.getInstance('sensors')).problems).join()).toMatch(/Entity named 'ZoneDimension'/);
  });

  it('the basic data has the defaults of the sensor DSL when it says less', async () => {
    const { bango } = await openProject('gresint');
    await bango.setText('basic', 'basic MyApp');
    const spec = ((await bango.toJson('basic')) as { data: { basicData: Obj } }).data.basicData;
    expect(spec).toEqual({
      name: 'MyApp',
      index: { component: 'STATIC', view: 'welcome' },
      languages: ['en', 'es', 'gl'],
      packageInfo: { artifactId: 'MyApp', groupId: 'es.udc.lbd.myapp' },
      SRID: '4326'
    });
    expect(((await bango.toJson('basic')) as Obj).features).toEqual([]);
  });

  it('the build carries every instance spec and the merged document', async () => {
    const { bango, seed } = await openProject('gresint');
    const result = await bango.build('gresint');
    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.model!.spec).toEqual(seed.expected.gresint);
    const byMetamodel = Object.fromEntries(result.model!.instances.map(i => [i.metamodel, i.spec]));
    expect(byMetamodel.datamodel).toEqual(await bango.toJson('datamodel'));
    expect(byMetamodel.sensors).toEqual(await bango.toJson('sensors'));
    expect(byMetamodel.basic).toEqual(await bango.toJson('basic'));
  });
});

describe('forms and lists', () => {
  it('forms and lists fill their slots of the document', async () => {
    const { bango } = await openProject('catalog');
    const spec = (await bango.toProjectJson()) as { data: Obj };
    const forms = spec.data.forms as Obj[];
    expect(forms[0]).toEqual({
      name: 'ProductForm', label: 'Product', entity: 'Product',
      fields: [
        { name: 'name', label: 'Name', readOnly: false },
        { name: 'price', label: 'price', readOnly: false },
        { name: 'inStock', label: 'In stock', readOnly: true },
        { name: 'category', label: 'category', readOnly: false }
      ]
    });
    // a form without a block of fields shows every field of its entity: it says nothing about them
    expect(forms[1]).toEqual({ name: 'CategoryForm', label: 'CategoryForm', entity: 'Category' });

    const lists = spec.data.lists as Obj[];
    expect(lists[0]).toEqual({
      name: 'Products', label: 'Products', entity: 'Product', pageSize: 20, sortBy: 'name', descending: false,
      columns: [{ name: 'name', label: 'name' }, { name: 'price', label: 'Price (EUR)' }, { name: 'category', label: 'category' }]
    });
    expect(lists[1]).toEqual({ name: 'Categories', label: 'Categories', entity: 'Category', sortBy: 'name', descending: true });
  });

  it('together with basic they fill the empty arrays of its skeleton instead of replacing them', async () => {
    const { bango } = await openProject('catalog');
    await bango.compose(['basic', 'datamodel', 'forms', 'lists']);
    await bango.setText('basic', 'basic catalog');
    const spec = (await bango.toProjectJson()) as { data: Obj };
    expect(Object.keys(spec.data)).toEqual(['basicData', 'dataModel', 'dataWarehouse', 'forms', 'lists', 'menus', 'mapViewer', 'statics']);
    expect((spec.data.forms as Obj[]).map(f => f.name)).toEqual(['ProductForm', 'CategoryForm']);
    expect((spec.data.lists as Obj[]).map(l => l.name)).toEqual(['Products', 'Categories']);
    expect(spec.data.menus).toEqual([]);
    // the slots of metamodels that are not in the project stay empty
    expect(spec.data.dataWarehouse).toEqual({});
    expect(spec.data.mapViewer).toEqual({});
  });

  it('they need the data model, and are not part of a product that does not use them', async () => {
    const { bango } = await openProject('forms-only');
    const s = await bango.getInstance('forms');
    expect(s.available).toBe(false);
    expect(errors(s.problems).join()).toMatch(/'forms' needs 'datamodel'/);

    const city = await openProject('city');
    expect(await city.bango.toJson('forms')).toBeUndefined();
    expect(Object.keys(((await city.bango.toProjectJson()) as Obj).data as Obj).sort()).toEqual(['dataModel', 'mapViewer']);
  });

  const cases: [string, 'forms' | 'lists', string, string, RegExp][] = [
    ['a form with a field the entity does not have', 'forms', '  field price\n', '  field cost\n', /Could not resolve reference to Field named 'cost'/],
    ['a field listed twice', 'forms', '  field price\n', '  field price\n  field price\n', /field 'price' is listed twice/],
    ['a form defined twice', 'forms', 'form CategoryForm entity Category', 'form ProductForm entity Category', /duplicate form 'ProductForm'/],
    ['a form of an entity that does not exist', 'forms', 'form CategoryForm entity Category', 'form CategoryForm entity Nothing', /Entity named 'Nothing'/],
    ['a column the entity does not have', 'lists', '  column price label', '  column cost label', /Could not resolve reference to Field named 'cost'/],
    ['a list sorted by something the entity does not have', 'lists', 'sortBy name {', 'sortBy rank {', /Could not resolve reference to Field named 'rank'/],
    ['a page size of zero', 'lists', 'pageSize 20', 'pageSize 0', /pageSize must be at least 1/],
    ['a list defined twice', 'lists', 'list Categories entity', 'list Products entity', /duplicate list 'Products'/]
  ];
  it.each(cases)('reports %s', async (_what, metamodel, from, to, pattern) => {
    const { bango, project } = await openProject('catalog');
    expect(project.instances[metamodel]).toContain(from);
    const s = await bango.setText(metamodel, project.instances[metamodel].replace(from, to));
    expect(errors(s.problems).join('\n')).toMatch(pattern);
  });

  it('the form view of a form: entities are references, the flags are checkboxes', async () => {
    const { bango } = await openProject('catalog');
    const schema = (await bango.getFormSchema('forms'))!;
    expect(schema.types.FormDef.fields.find(f => f.name === 'entity')).toMatchObject({ kind: 'ref', refType: 'Entity', required: true });
    expect(schema.types.FormField.fields.find(f => f.name === 'readOnly')).toMatchObject({ kind: 'boolean' });
    const added = await bango.applyEdit('forms', { kind: 'add', path: [], feature: 'forms', type: 'FormDef' });
    expect(added.text).toMatch(/form newFormDef entity (Category|Product)/);
    expect(errors(added.problems)).toEqual([]);
  });
});

describe('options', () => {
  it('format generic gives the plain tree instead of the mapping', async () => {
    const { bango } = await openProject('gresint');
    const generic = (await bango.toJson('datamodel', { format: 'generic' })) as Obj;
    expect(generic.$type).toBe('Model');
    expect(generic.data).toBeUndefined();
  });

  it('merge false (or the generic format) keeps one entry per metamodel', async () => {
    const { bango } = await openProject('gresint');
    const split = (await bango.toProjectJson({ merge: false })) as Obj;
    expect(Object.keys(split).sort()).toEqual(['basic', 'datamodel', 'gismodel', 'sensors']);
    expect(split.datamodel).toEqual(await bango.toJson('datamodel'));
    const generic = (await bango.toProjectJson({ format: 'generic' })) as Obj;
    expect((generic.sensors as Obj).$type).toBe('SensorModel');
    expect((generic.basic as Obj).$type).toBe('BasicModel');
  });

  it('a metamodel without a JSON mapping has no place in the merged document', async () => {
    const { bango } = await openProject('city');
    await bango.setGrammar('combo', COMBO_GRAMMAR);
    await bango.compose(['combo', 'datamodel', 'gismodel']);
    await bango.setInstances({ combo: COMBO_INSTANCE });
    expect(await bango.toProjectJson()).toEqual({});
    // but it is there per metamodel, in the generic shape
    expect(((await bango.toProjectJson({ merge: false })) as Obj).combo).toMatchObject({ $type: 'Combined' });
    expect((await bango.toJson('combo')) as Obj).toMatchObject({ $type: 'Combined' });
  });

  it('metamodels outside the project and missing instances are left out', async () => {
    const { bango, seed } = await openProject('shop');
    expect(Object.keys((await bango.toProjectJson()) as Obj)).toEqual(['data']);
    expect(await bango.toJson('sensors')).toBeUndefined();
    expect(seed.projects.shop.instances.sensors).toBeUndefined();
  });
});

describe('mergeJson', () => {
  it('merges objects by key, concatenates arrays, keeps equal values', () => {
    expect(mergeJson({ a: { x: 1 }, list: [1] }, { a: { y: 2 }, list: [2], b: true }, { a: { x: 1 } })).toEqual({
      a: { x: 1, y: 2 }, list: [1, 2], b: true
    });
  });

  it('two different values for the same path are a conflict that names the path', () => {
    expect(() => mergeJson({ data: { name: 'a' } }, { data: { name: 'b' } })).toThrow(/data\.name/);
  });

  it('an empty merge is an empty document', () => {
    expect(mergeJson()).toEqual({});
  });
});

describe('mappings that go wrong', () => {
  it('a mapping that throws is reported with the metamodel it belongs to, and fails the build', async () => {
    const { bango } = await openProject('shop');
    await bango.setSpec('datamodel', 'return function (model) { return model.nothing.here; };');
    await bango.compose(['datamodel']);
    await expect(bango.toJson('datamodel')).rejects.toThrow(/JSON mapping of 'datamodel' failed/);
    const build = await bango.build('shop');
    expect(build.ok).toBe(false);
    expect(build.errors.join('\n')).toMatch(/datamodel: The JSON mapping of 'datamodel' failed/);
  });

  it('a mapping that is not a function is a problem of its metamodel', async () => {
    const { bango } = await openProject('shop');
    await bango.setSpec('datamodel', 'return { not: "a function" };');
    const info = await bango.compose(['datamodel']);
    expect(info.grammars.find(g => g.name === 'datamodel')!.problems.map(p => p.message).join()).toMatch(/datamodel\.spec\.js: a JSON mapping must `return function/);
  });

  it('a mapping with a syntax error is a problem too, and the metamodel falls back to the generic JSON', async () => {
    const { bango } = await openProject('shop');
    await bango.setSpec('datamodel', 'return function ( {');
    const info = await bango.compose(['datamodel']);
    expect(info.grammars.find(g => g.name === 'datamodel')!.problems.map(p => p.message).join()).toMatch(/datamodel\.spec\.js/);
    expect(((await bango.toJson('datamodel')) as Obj).$type).toBe('Model');
  });

  it('values that are not JSON cannot leak out of a mapping', async () => {
    const { bango } = await openProject('shop');
    await bango.setSpec('datamodel', 'return function () { return { f: () => 1, u: undefined, n: 1 }; };');
    await bango.compose(['datamodel']);
    expect(await bango.toJson('datamodel')).toEqual({ n: 1 });
  });

  it('a mapping can be written as { root, map }, and the root is merged first', async () => {
    const { bango } = await openProject('city');
    await bango.setSpec('datamodel', 'return function () { return { data: { b: 1 } }; };');
    await bango.setSpec('gismodel', 'return { root: true, map() { return { data: { a: 1 }, top: true }; } };');
    await bango.compose(['datamodel', 'gismodel']);
    // (gismodel needs datamodel, so it would go first anyway; the second half makes the flag decide)
    expect(JSON.stringify(await bango.toProjectJson())).toBe('{"data":{"a":1,"b":1},"top":true}');
    await bango.setSpec('gismodel', 'return function () { return { data: { a: 1 }, top: true }; };');
    await bango.setSpec('datamodel', 'return { root: true, map() { return { data: { b: 1 } }; } };');
    await bango.compose(['datamodel', 'gismodel']);
    expect(JSON.stringify(await bango.toProjectJson())).toBe('{"data":{"b":1,"a":1},"top":true}');
  });

  it('two metamodels that define the same value make the merge fail, and so the build', async () => {
    const { bango } = await openProject('city');
    await bango.setSpec('datamodel', 'return function () { return { data: { name: "from the data model" } }; };');
    await bango.setSpec('gismodel', 'return function () { return { data: { name: "from the GIS model" } }; };');
    await bango.compose(['datamodel', 'gismodel']);
    await expect(bango.toProjectJson()).rejects.toThrow(/data\.name/);
    expect((await bango.build('city')).ok).toBe(false);
  });
});
