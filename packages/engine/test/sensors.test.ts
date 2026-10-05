import { describe, expect, it } from 'vitest';
import { errors, openProject } from '../../../test-support/harness.js';

const warnings = (ps: { severity: string; message: string }[]) => ps.filter(p => p.severity === 'warning').map(p => p.message);

describe('sensors metamodel', () => {
  it('needs the data model and the map viewer, and says so when they are missing', async () => {
    const { bango } = await openProject('sensors-only');
    const s = await bango.getInstance('sensors');
    expect(s.available).toBe(false);
    expect(errors(s.problems).join()).toMatch(/'sensors' needs 'datamodel', 'gismodel'/);
    const check = await bango.checkSelection(['sensors']);
    expect(check.ok).toBe(false);
    expect(check.problems.map(p => p.missing).sort()).toEqual(['datamodel', 'gismodel']);
    expect(check.suggested.sort()).toEqual(['datamodel', 'gismodel', 'sensors']);
  });

  it('the gresint example is valid, without a single warning', async () => {
    const { bango } = await openProject('gresint');
    for (const m of ['basic', 'datamodel', 'gismodel', 'sensors']) {
      const s = await bango.getInstance(m);
      expect(errors(s.problems), m).toEqual([]);
      expect(warnings(s.problems), m).toEqual([]);
    }
  });

  it('what a sensor points at lives in the other two metamodels', async () => {
    const { bango } = await openProject('gresint');
    const { ast } = await bango.getInstance('sensors');
    const sensor = (ast!.children.sensors as { refs: Record<string, { resolved: boolean; targetMetamodel: string; targetType: string; targetName: string }> }[])[0];
    expect(sensor.refs.entity).toMatchObject({ resolved: true, targetMetamodel: 'datamodel', targetType: 'Entity', targetName: 'StationObservationEntity' });
    expect(sensor.refs.factTable).toMatchObject({ targetMetamodel: 'datamodel', targetName: 'StationObservationMeasurement' });
    expect(sensor.refs.defaultMap).toMatchObject({ targetMetamodel: 'gismodel', targetType: 'MapDef' });
    expect(sensor.refs.defaultLayer).toMatchObject({ targetMetamodel: 'gismodel', targetType: 'GeoJsonLayer' });
  });

  it('an entity that does not exist in the data model is a linking error', async () => {
    const { bango, project } = await openProject('gresint');
    const s = await bango.setText('sensors', project.instances.sensors.replace('entity StationObservationEntity', 'entity Boat'));
    expect(errors(s.problems).join()).toMatch(/Entity named 'Boat'/);
  });

  it('removing an entity from the data model breaks what uses it', async () => {
    const { bango, project } = await openProject('gresint');
    await bango.setText('datamodel', project.instances.datamodel.replace(/entity StationObservationMeasurement[\s\S]*$/, ''));
    expect(errors((await bango.getInstance('sensors')).problems).join()).toMatch(/StationObservationMeasurement/);
    expect(errors((await bango.getInstance('datamodel')).problems).join()).toMatch(/StationObservationMeasurement/);
  });

  describe('constraints that cross metamodels', () => {
    const cases: [string, string, string, RegExp][] = [
      ['a layer that shows another entity than the sensor stores', 'layer stationobservation-layer {', 'layer ZoneDimension {', /layer 'ZoneDimension' shows entity 'ZoneDimension', but sensor 'StationObservation' stores in 'StationObservationEntity'/],
      ['a measurement that is not in the fact table', '    quality Integer', '    temperature Double', /measurement 'temperature' is not a property of fact table 'StationObservationMeasurement'/],
      ['a measurement of another type than its column', 'quality Integer', 'quality String', /measurement 'quality' is String, but 'StationObservationMeasurement.quality' is Integer/],
      ['a fact table that does not point at the sensor entity', 'factTable StationObservationMeasurement', 'factTable StationObservationEntity', /fact table 'StationObservationEntity' has no relationship to 'StationObservationEntity'/],
      ['a categorical field that is not in the fact table', 'field sensorType', 'field kind', /categorical field 'kind' is not a property of fact table/],
      ['a duplicated measurement', '    quality Integer', '    quality Integer\n    quality Integer', /measurement 'quality' is declared twice/],
      ['a duplicated dimension', '  categorical SensorType field sensorType', '  categorical SensorType field sensorType\n  categorical SensorType field sensorType', /dimension 'SensorType' is declared twice/],
      ['a sensor repeated', 'sensor StationObservation time 10', 'sensorGroup StationObservation (StationObservation)\nsensor StationObservation time 10', /duplicate sensor or group 'StationObservation'/]
    ];
    it.each(cases)('reports %s', async (_what, from, to, pattern) => {
      const { bango, project } = await openProject('gresint');
      expect(project.instances.sensors).toContain(from);
      const s = await bango.setText('sensors', project.instances.sensors.replace(from, to));
      expect(errors(s.problems).join('\n')).toMatch(pattern);
    });

    it('warns, without failing, when the geometry disagrees with the entity, the map hides the layer, or a dimension is unrelated', async () => {
      const { bango, project } = await openProject('gresint');
      let text = project.instances.sensors.replace('geometry Polygon', 'geometry Point');
      text = text.replace('spatial ZoneDimension entities (ZoneDimension)', 'spatial ZoneDimension entities (StationObservationMeasurement)');
      const s = await bango.setText('sensors', text);
      expect(errors(s.problems)).toEqual([]);
      expect(warnings(s.problems).join('\n')).toMatch(/says Point, but 'StationObservationEntity.geometry' is Polygon/);

      await bango.setText('gismodel', project.instances.gismodel.replace('  use stationobservation-layer style grayPoint selected order 1\n', ''));
      expect(warnings((await bango.getInstance('sensors')).problems).join('\n')).toMatch(/map 'stationobservation-map' does not show layer 'stationobservation-layer'/);
    });
  });

  it('offers entities of the data model and maps and layers of the map viewer in completion', async () => {
    const { bango } = await openProject('gresint');
    const head = 'sensors s\nsensor X time 1 geometry Point ';
    const complete = async (tail: string) => {
      const text = head + tail;
      const lines = text.split('\n');
      return (await bango.complete('sensors', text, lines.length - 1, lines[lines.length - 1].length)).map(i => i.label);
    };
    expect(await complete('entity ')).toEqual(expect.arrayContaining(['ZoneDimension', 'StationObservationEntity', 'StationObservationMeasurement']));
    expect(await complete('entity ZoneDimension factTable ')).toEqual(expect.arrayContaining(['StationObservationMeasurement']));
    expect(await complete('entity ZoneDimension factTable ZoneDimension map ')).toContain('stationobservation-map');
    expect(await complete('entity ZoneDimension factTable ZoneDimension map m layer ')).toEqual(expect.arrayContaining(['stationobservation-layer', 'ZoneDimension']));
  });

  it('the form offers data types as a choice and entities as references', async () => {
    const { bango } = await openProject('gresint');
    const schema = (await bango.getFormSchema('sensors'))!;
    const type = schema.types.Measurement.fields.find(f => f.name === 'dataType')!;
    expect(type.kind).toBe('enum');
    expect(type.options).toContain('Double');
    expect(schema.types.SensorDef.fields.find(f => f.name === 'entity')).toMatchObject({ kind: 'ref', refType: 'Entity', required: true });
    expect(schema.types.SensorDef.fields.find(f => f.name === 'defaultMap')).toMatchObject({ kind: 'ref', refType: 'MapDef' });
    expect(schema.types.SensorDef.fields.find(f => f.name === 'defaultLayer')).toMatchObject({ kind: 'ref', refType: 'GeoJsonLayer' });
    expect(schema.types.SensorDef.fields.find(f => f.name === 'dimensions')!.childTypes).toEqual(['SpatialDimension', 'CategoricalDimension']);
  });

  it('adding a sensor from the form picks real entities, a real map and a real layer', async () => {
    const { bango } = await openProject('gresint');
    const s = await bango.applyEdit('sensors', { kind: 'add', path: [], feature: 'sensors', type: 'SensorDef' });
    expect(s.text).toMatch(/sensor newSensorDef time 0 geometry Point\s+entity \S+ factTable \S+\s+map stationobservation-map layer \S+/);
    // only the constraints can complain (the new sensor measures nothing real), never the syntax or a reference
    expect(errors(s.problems).join('\n')).not.toMatch(/Expecting|Could not resolve/);
  });

  it('the generic JSON of the whole gresint product is available alongside the mapping', async () => {
    const { bango } = await openProject('gresint');
    const generic = (await bango.toJson('sensors', { format: 'generic', refs: 'names' })) as { sensors: { entity: string; dimensions: { $type: string }[] }[] };
    expect(generic.sensors[0].entity).toBe('StationObservationEntity');
    expect(generic.sensors[0].dimensions.map(d => d.$type)).toEqual(['SpatialDimension', 'CategoricalDimension']);
  });
});

describe('data model constraints', () => {
  it('a bidirectional relationship needs the other side, pointing back, with one owner', async () => {
    const { bango, project } = await openProject('gresint');
    const text = project.instances.datamodel;

    let s = await bango.setText('datamodel', text.replace('inverse zonedimension_id', 'inverse nowhere'));
    expect(errors(s.problems).join('\n')).toMatch(/'StationObservationEntity' has no relationship 'nowhere'/);

    s = await bango.setText('datamodel', text.replace('relation zonedimension_id -> ZoneDimension inverse StationObservationEntity owner', 'relation zonedimension_id -> ZoneDimension inverse StationObservationEntity'));
    expect(errors(s.problems).join('\n')).toMatch(/exactly one side of/);

    s = await bango.setText('datamodel', text.replace('inverse StationObservationEntity owner', 'inverse sensors owner'));
    expect(errors(s.problems).join('\n')).toMatch(/should name 'StationObservationEntity' as its inverse/);
  });
});

describe('map viewer constraints', () => {
  const cases: [string, string, string, RegExp][] = [
    ['a layer that draws a field the entity does not have', 'entity ZoneDimension\n', 'entity ZoneDimension field outline\n', /entity 'ZoneDimension' has no property 'outline' to draw/],
    ['a layer that draws a field that is not a geometry', 'entity ZoneDimension\n', 'entity ZoneDimension field name\n', /'ZoneDimension.name' is a String, not a geometry/],
    ['a default style that is not available', 'defaultStyle grayPolygon\n', 'defaultStyle redPolygon\n', /defaultStyle 'redPolygon' must be one of availableStyles/],
    ['a layer on a map without a style', 'use ZoneDimension style grayPolygon order 2', 'use ZoneDimension order 2', /layer 'ZoneDimension' draws data: choose a style for it/],
    ['a style the layer does not offer', 'use ZoneDimension style grayPolygon order 2', 'use ZoneDimension style redPolygon order 2', /style 'redPolygon' is not one of the available styles of layer 'ZoneDimension'/],
    ['an interval that goes backwards', 'from 20 to 40 style orangePoint', 'from 40 to 20 style orangePoint', /interval goes backwards: 40 to 20/]
  ];
  it.each(cases)('reports %s', async (_what, from, to, pattern) => {
    const { bango, project } = await openProject('gresint');
    expect(project.instances.gismodel).toContain(from);
    const s = await bango.setText('gismodel', project.instances.gismodel.replace(from, to));
    expect(errors(s.problems).join('\n')).toMatch(pattern);
  });

  it('warns about a repeated order and a second base layer', async () => {
    const { bango, project } = await openProject('gresint');
    const s = await bango.setText('gismodel', project.instances.gismodel.replace('use ZoneDimension style grayPolygon order 2', 'use ZoneDimension style grayPolygon baseLayer order 1'));
    expect(warnings(s.problems).join('\n')).toMatch(/order 1 is used twice/);
    expect(warnings(s.problems).join('\n')).toMatch(/more than one base layer/);
  });
});
