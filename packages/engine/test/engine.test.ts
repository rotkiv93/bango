import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';

describe('instances', () => {
  it.each(['shop', 'city', 'composite'])('the %s example validates', async name => {
    const { bango, project } = await openProject(name);
    for (const metamodel of Object.keys(project.instances)) {
      const s = await bango.getInstance(metamodel);
      expect(s.available).toBe(true);
      expect(errors(s.problems), metamodel).toEqual([]);
    }
  });

  it('a layer without an entity is a parser error', async () => {
    const { bango } = await openProject('city');
    const s = await bango.setText('mapviewer', 'mapviewer\ngeojsonlayer roads defaultStyle thin availStyles thin');
    expect(errors(s.problems).length).toBeGreaterThan(0);
  });

  it('an unknown entity is a linking error that clears when the other metamodel provides it', async () => {
    const { bango, project } = await openProject('city');
    await bango.setText('datamodel', 'datamodel shop');
    expect(errors((await bango.getInstance('mapviewer')).problems).join()).toMatch(/Could not resolve reference to Entity named 'Road'/);
    await bango.setText('datamodel', project.instances.datamodel);
    expect(errors((await bango.getInstance('mapviewer')).problems)).toEqual([]);
  });

  it('keeps one instance per metamodel: setting the text again replaces it', async () => {
    const { bango } = await openProject('city');
    expect((await bango.getInstances()).map(i => i.metamodel).sort()).toEqual(['datamodel', 'mapviewer']);
    await bango.setText('datamodel', 'datamodel a');
    await bango.setText('datamodel', 'datamodel b');
    const all = await bango.getInstances();
    expect(all).toHaveLength(2);
    expect(all.find(i => i.metamodel === 'datamodel')!.text).toBe('datamodel b');
  });

  it('removing an instance leaves references to it dangling', async () => {
    const { bango } = await openProject('city');
    await bango.removeInstance('datamodel');
    expect((await bango.getInstances()).map(i => i.metamodel)).toEqual(['mapviewer']);
    expect(errors((await bango.getInstance('mapviewer')).problems).join()).toMatch(/Road/);
  });

  it('a metamodel outside the project has no usable instance', async () => {
    const { bango } = await openProject('shop');
    const s = await bango.setText('mapviewer', 'mapviewer');
    expect(s.available).toBe(false);
    expect(s.ast).toBeUndefined();
    expect(errors(s.problems).join()).toMatch(/not part of this project/);
  });

  it('a metamodel whose dependency is missing is blocked with the reason', async () => {
    const { bango } = await openProject('map-only');
    const s = await bango.getInstance('mapviewer');
    expect(s.available).toBe(false);
    expect(errors(s.problems).join()).toMatch(/'mapviewer' needs 'datamodel'/);
  });

  it('breaking a metamodel keeps its instances parsing and flags them stale', async () => {
    const { bango, seed } = await openProject('city');
    await bango.setGrammar('datamodel', seed.grammars.datamodel.replace('Entity:', 'Thing:'));
    const info = await bango.compose(['datamodel', 'mapviewer']);
    expect(info.grammars.find(g => g.name === 'datamodel')!.problems.some(p => p.severity === 'error')).toBe(true);
    const s = await bango.getInstance('datamodel');
    expect(s.stale).toBe(true);
    expect(s.available).toBe(true);
  });

  it('a composite metamodel mixes both metamodels in one document and validates across them', async () => {
    const { bango, project } = await openProject('composite');
    expect(errors((await bango.getInstance('app')).problems)).toEqual([]);
    const broken = await bango.setText('app', project.instances.app.replace('entity Building', 'entity Missing'));
    expect(errors(broken.problems).join()).toMatch(/Building/);
  });
});

describe('AST', () => {
  it('exposes resolved cross-metamodel references', async () => {
    const { bango } = await openProject('city');
    const { ast } = await bango.getInstance('mapviewer');
    const layers = ast!.children.layers as { type: string; refs: Record<string, { resolved: boolean; targetMetamodel?: string; targetName?: string }> }[];
    expect(layers[0].type).toBe('GeoJsonLayer');
    expect(layers[0].refs.entity).toMatchObject({ resolved: true, targetMetamodel: 'datamodel', targetName: 'Road' });
  });

  it('keeps source ranges so views can point back to the text', async () => {
    const { bango } = await openProject('city');
    const { ast } = await bango.getInstance('mapviewer');
    expect(ast!.range).toMatchObject({ startLine: 0 });
    expect((ast!.children.layers as { range?: unknown }[])[0].range).toBeDefined();
  });
});

describe('editor support', () => {
  it('completion offers entities of the other metamodel', async () => {
    const { bango } = await openProject('city');
    const text = 'mapviewer\ngeojsonlayer roads entity ';
    const items = await bango.complete('mapviewer', text, 1, 'geojsonlayer roads entity '.length);
    expect(items.map(i => i.label)).toContain('Road');
  });

  it('go-to-definition jumps into the other metamodel instance', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.mapviewer;
    const lines = text.split('\n');
    const row = lines.findIndex(l => l.startsWith('geojsonlayer'));
    const defs = await bango.definition('mapviewer', text, row, lines[row].indexOf('Road') + 1);
    expect(defs[0]?.metamodel).toBe('datamodel');
  });

  it('hover answers without failing (plain text or nothing)', async () => {
    const { bango, project } = await openProject('city');
    const lines = project.instances.mapviewer.split('\n');
    const row = lines.findIndex(l => l.startsWith('geojsonlayer'));
    const h = await bango.hover('mapviewer', project.instances.mapviewer, row, lines[row].indexOf('Road') + 1);
    expect(h === undefined || typeof h === 'string').toBe(true);
  });

  it('features for an unavailable metamodel are empty, not errors', async () => {
    const { bango } = await openProject('shop');
    expect(await bango.complete('mapviewer', 'mapviewer ', 0, 10)).toEqual([]);
    expect(await bango.hover('mapviewer', 'mapviewer', 0, 1)).toBeUndefined();
  });

  it('completion on unsaved text works against the live editor content', async () => {
    const { bango } = await openProject('city');
    const items = await bango.complete('datamodel', 'datamodel shop\nentity ', 1, 7);
    expect(Array.isArray(items)).toBe(true);
    expect((await bango.getInstance('datamodel')).text).toBe('datamodel shop\nentity ');
  });
});

describe('constraints', () => {
  const style2 = 'geojsonstyle wide fillColor "#fff" strokeColor "#000" fillOpacity 1.0 strokeOpacity 1.0 radius 1.0\n';

  it('defaultStyle must be one of availableStyles', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.mapviewer.replace('defaultStyle thin', 'defaultStyle wide') + style2;
    expect(errors((await bango.setText('mapviewer', text)).problems).join()).toMatch(/must be one of availableStyles/);
  });

  it('duplicate fields are reported, also through the composite metamodel', async () => {
    const { bango } = await openProject('composite');
    const s = await bango.setText('app', 'app\nentity A {\n property x: String pk\n property x: String\n}\n');
    expect(errors(s.problems).join()).toMatch(/duplicate field 'x'/);
  });
});

describe('events and ordering', () => {
  it('notifies subscribers about edits and compositions, and stops after unsubscribe', async () => {
    const { bango } = await openProject('city');
    const seen: EngineEvent[] = [];
    const off = await bango.subscribe(e => seen.push(e));
    await bango.setText('datamodel', 'datamodel x');
    await bango.compose(['datamodel']);
    expect(seen).toEqual([{ type: 'instance', metamodel: 'datamodel' }, { type: 'composition' }]);
    await off();
    await bango.setText('datamodel', 'datamodel y');
    expect(seen).toHaveLength(2);
  });

  it('overlapping calls are applied in order and leave a consistent index', async () => {
    const { bango, project } = await openProject('city');
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) pending.push(bango.setText('datamodel', `datamodel v${i}`));
    pending.push(bango.setText('datamodel', project.instances.datamodel));
    pending.push(bango.complete('mapviewer', project.instances.mapviewer, 1, 3));
    await Promise.all(pending);
    expect((await bango.getInstance('datamodel')).text).toBe(project.instances.datamodel);
    expect(errors((await bango.getInstance('mapviewer')).problems)).toEqual([]);
  });

  it('a throwing listener does not break the engine', async () => {
    const { bango } = await openProject('city');
    await bango.subscribe(() => { throw new Error('boom'); });
    await expect(bango.setText('datamodel', 'datamodel z')).resolves.toBeDefined();
  });
});
