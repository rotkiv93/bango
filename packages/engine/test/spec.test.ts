import { describe, expect, it } from 'vitest';
import { mergeJson, type JsonValue } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';

type Obj = { [key: string]: JsonValue };

describe('the product specification (gresint)', () => {
  it('the specs of the three metamodels, merged, are the given JSON', async () => {
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

    const mapviewer = (await bango.toJson('mapviewer')) as Obj;
    expect(Object.keys(mapviewer.data as Obj)).toEqual(['mapViewer']);
    expect(Object.keys((mapviewer.data as Obj).mapViewer as Obj)).toEqual(['maps', 'layers', 'styles']);

    const sensors = (await bango.toJson('sensors')) as Obj;
    expect(Object.keys(sensors)).toEqual(['features', 'data']);
    expect(Object.keys(sensors.data as Obj)).toEqual(['basicData', 'dataModel', 'dataWarehouse', 'forms', 'lists', 'menus', 'mapViewer', 'statics']);
    // the slots for the other two are empty: they are theirs to fill
    expect((sensors.data as Obj).dataModel).toEqual({});
    expect((sensors.data as Obj).mapViewer).toEqual({});
  });

  it('merging does not depend on the order of the parts, only the key order does', async () => {
    const { bango, seed } = await openProject('gresint');
    const parts = await Promise.all(['datamodel', 'mapviewer', 'sensors'].map(m => bango.toJson(m) as Promise<JsonValue>));
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
      expect(mergeJson(...order.map(i => parts[i]))).toEqual(seed.expected.gresint);
    }
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

  it('the product has the defaults of the sensor DSL when it says less', async () => {
    const { bango } = await openProject('gresint');
    await bango.setText('sensors', 'sensors s\nproduct MyApp');
    const spec = ((await bango.toJson('sensors')) as { data: { basicData: Obj } }).data.basicData;
    expect(spec).toEqual({
      name: 'MyApp',
      index: { component: 'STATIC', view: 'welcome' },
      languages: ['en', 'es', 'gl'],
      packageInfo: { artifactId: 'MyApp', groupId: 'es.udc.lbd.myapp' },
      SRID: '4326'
    });
  });

  it('the build carries every instance spec and the merged document', async () => {
    const { bango, seed } = await openProject('gresint');
    const result = await bango.build('gresint');
    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.model!.spec).toEqual(seed.expected.gresint);
    const byMetamodel = Object.fromEntries(result.model!.instances.map(i => [i.metamodel, i.spec]));
    expect(byMetamodel.datamodel).toEqual(await bango.toJson('datamodel'));
    expect(byMetamodel.sensors).toEqual(await bango.toJson('sensors'));
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
    expect(Object.keys(split).sort()).toEqual(['datamodel', 'mapviewer', 'sensors']);
    expect(split.datamodel).toEqual(await bango.toJson('datamodel'));
    const generic = (await bango.toProjectJson({ format: 'generic' })) as Obj;
    expect((generic.sensors as Obj).$type).toBe('SensorModel');
  });

  it('a metamodel without a JSON mapping has no place in the merged document', async () => {
    const { bango } = await openProject('composite');
    expect(await bango.toProjectJson()).toEqual({});
    // but it is there per metamodel, in the generic shape
    expect(((await bango.toProjectJson({ merge: false })) as Obj).app).toMatchObject({ $type: 'Application' });
    expect((await bango.toJson('app')) as Obj).toMatchObject({ $type: 'Application' });
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

  it('two metamodels that define the same value make the merge fail, and so the build', async () => {
    const { bango } = await openProject('city');
    await bango.setSpec('datamodel', 'return function () { return { data: { name: "from the data model" } }; };');
    await bango.setSpec('mapviewer', 'return function () { return { data: { name: "from the map viewer" } }; };');
    await bango.compose(['datamodel', 'mapviewer']);
    await expect(bango.toProjectJson()).rejects.toThrow(/data\.name/);
    expect((await bango.build('city')).ok).toBe(false);
  });
});
