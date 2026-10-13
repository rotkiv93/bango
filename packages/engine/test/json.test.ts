import { describe, expect, it } from 'vitest';
import { toJsonSpec, type JsonValue } from '../src/index.js';
import { openProject } from '../../../test-support/harness.js';

type Obj = { [key: string]: JsonValue };
const generic = { format: 'generic' } as const;

// the generic format: any instance of any metamodel as a plain tree. The metamodels' own mappings are in spec.test.ts.
describe('generic JSON', () => {
  it('is plain JSON: it survives a stringify round trip unchanged, in both formats', async () => {
    const { bango } = await openProject('gresint');
    for (const m of ['datamodel', 'gismodel', 'sensors']) {
      for (const options of [{}, generic]) {
        const spec = (await bango.toJson(m, options))!;
        expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
      }
    }
  });

  it('describes the instance without parser details', async () => {
    const { bango } = await openProject('gresint');
    const spec = (await bango.toJson('datamodel', generic)) as Obj;
    expect(spec.$type).toBe('Model');
    expect(spec.name).toBe('gresint');
    const zone = (spec.entities as Obj[])[0];
    expect(zone).toMatchObject({ $type: 'Entity', name: 'ZoneDimension', displayString: '$id' });
    expect((zone.fields as Obj[])[0]).toMatchObject({ $type: 'PropertyField', name: 'id', class: 'Long', autoinc: true, pk: true });
    expect(JSON.stringify(spec)).not.toMatch(/range|startLine|resolved/);
  });

  it('writes key order the way a person reads it: type, name, values, references, children', async () => {
    const { bango } = await openProject('gresint');
    const sensor = ((await bango.toJson('sensors', generic)) as Obj).sensors as Obj[];
    expect(Object.keys(sensor[0]).slice(0, 3)).toEqual(['$type', 'name', 'time']);
    expect(Object.keys(sensor[0]).indexOf('entity')).toBeLessThan(Object.keys(sensor[0]).indexOf('measureData'));
  });

  it('references say where their target lives, also across metamodels', async () => {
    const { bango } = await openProject('gresint');
    const sensor = (((await bango.toJson('sensors', generic)) as Obj).sensors as Obj[])[0];
    expect(sensor.entity).toEqual({ $ref: 'StationObservationEntity', $type: 'Entity', $in: 'datamodel' });
    expect(sensor.defaultLayer).toEqual({ $ref: 'stationobservation-layer', $type: 'GeoJsonLayer', $in: 'gismodel' });
    expect(sensor.defaultMap).toEqual({ $ref: 'stationobservation-map', $type: 'MapDef', $in: 'gismodel' });
  });

  it('marks references that do not resolve', async () => {
    const { bango, project } = await openProject('gresint');
    await bango.setText('sensors', project.instances.sensors.replace('entity StationObservationEntity', 'entity Boat'));
    const sensor = (((await bango.toJson('sensors', generic)) as Obj).sensors as Obj[])[0];
    expect(sensor.entity).toEqual({ $ref: 'Boat', $unresolved: true });
  });

  it('options: names only, no types, positions', async () => {
    const { bango } = await openProject('gresint');
    const names = (((await bango.toJson('sensors', { ...generic, refs: 'names' })) as Obj).sensors as Obj[])[0];
    expect(names.entity).toBe('StationObservationEntity');

    const bare = (await bango.toJson('datamodel', { ...generic, types: false })) as Obj;
    expect(JSON.stringify(bare)).not.toContain('$type');

    const ranged = (await bango.toJson('datamodel', { ...generic, ranges: true })) as Obj;
    expect(ranged.$range).toEqual([0, 0, expect.any(Number), expect.any(Number)]);
  });

  it('leaves out empty lists and null values, keeps false flags', async () => {
    const { bango } = await openProject('gresint');
    const layers = ((await bango.toJson('gismodel', generic)) as Obj).layers as Obj[];
    expect(layers[0].$type).toBe('TileLayer');
    const geo = layers[1];
    expect(geo.editable).toBe(false);
    expect(Object.values(geo).some(v => Array.isArray(v) && v.length === 0)).toBe(false);
  });

  it('is undefined when the metamodel is not available or the instance does not exist', async () => {
    const { bango } = await openProject('shop');
    expect(await bango.toJson('gismodel')).toBeUndefined();
    expect(await bango.toJson('nope', generic)).toBeUndefined();
  });

  it('follows edits', async () => {
    const { bango } = await openProject('shop');
    await bango.setText('datamodel', 'datamodel renamed');
    expect(((await bango.toJson('datamodel', generic)) as Obj).name).toBe('renamed');
  });

  it('toJsonSpec works on any AST, e.g. the one of a grammar', async () => {
    const { bango } = await openProject('shop');
    const spec = toJsonSpec((await bango.getGrammarAst('datamodel'))!, { refs: 'names' }) as Obj;
    expect(spec.$type).toBe('Grammar');
    expect(spec.name).toBe('DataModel');
  });
});
