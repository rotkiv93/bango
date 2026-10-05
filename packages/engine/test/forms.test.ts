import { describe, expect, it } from 'vitest';
import { ModelComposer } from '@bango/composer';
import { Printer, indexRules, type AstDto } from '../src/index.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

// comparable shape of an AST: no source ranges, no resolution details, and key order does not matter
// (reprinting the root regroups top-level elements by grammar alternative, the content per feature is unchanged)
const shape = (v: unknown) =>
  JSON.stringify(v, (k, x) => {
    if (k === 'range' || k === 'resolved' || k.startsWith('target')) return undefined;
    if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)));
    return x;
  });

const offsetAt = (text: string, line: number, column: number) =>
  text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0) + column;

function* nodes(dto: AstDto): Generator<AstDto> {
  yield dto;
  for (const c of Object.values(dto.children)) for (const child of Array.isArray(c) ? c : [c]) yield* nodes(child);
}

describe('printer', () => {
  it('reprinting any node from its grammar rule parses back to the same AST', async () => {
    const seed = loadSeed();
    const composer = new ModelComposer();
    for (const [n, t] of Object.entries(seed.grammars)) composer.setGrammar(n, t);
    const composition = await composer.compose();

    let checked = 0;
    for (const projectName of ['city', 'gresint', 'catalog']) {
      const { bango, project } = await openProject(projectName);
      for (const [metamodel, text] of Object.entries(project.instances)) {
        const printer = new Printer(indexRules(composition.get(metamodel)!.grammar));
        const before = shape((await bango.getInstance(metamodel)).ast);
        for (const node of nodes((await bango.getInstance(metamodel)).ast!)) {
          const r = node.range!;
          const printed = printer.print(node, 0);
          const variant = text.slice(0, offsetAt(text, r.startLine, r.startColumn)) + printed + text.slice(offsetAt(text, r.endLine, r.endColumn));
          const s = await bango.setText(metamodel, variant);
          expect(errors(s.problems), `${metamodel}: ${node.type} -> ${printed}`).toEqual([]);
          expect(shape(s.ast), `${metamodel}: ${node.type}`).toBe(before);
          checked++;
        }
        await bango.setText(metamodel, text);
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 60_000);
});

describe('form schema', () => {
  it('has cross-metamodel reference types and concrete child types', async () => {
    const { bango } = await openProject('city');
    const schema = (await bango.getFormSchema('gismodel'))!;
    expect(schema.root).toBe('Gis');
    expect(schema.types.GeoJsonLayer.fields.find(f => f.name === 'entity')).toMatchObject({ kind: 'ref', refType: 'Entity', required: true });
    expect(schema.types.Gis.fields.find(f => f.name === 'layers')!.childTypes).toEqual(['TileLayer', 'GeoJsonLayer', 'WMSLayer']);
    expect(await bango.getFormSchema('nope')).toBeUndefined();
  });

  it('lists reference candidates from every metamodel', async () => {
    const { bango } = await openProject('city');
    const candidates = await bango.getRefCandidates('Entity');
    expect(candidates).toContainEqual({ name: 'Road', type: 'Entity', metamodel: 'datamodel' });
  });
});

describe('form edits', () => {
  const entityField = [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 0 }];

  it('changing an existing value keeps comments and layout', async () => {
    const { bango } = await openProject('city');
    const text = '// my model\ndatamodel shop\nentity Road {\n  property name: String pk // key\n}\n';
    await bango.setText('datamodel', text);
    const s = await bango.applyEdit('datamodel', { kind: 'set', path: entityField, feature: 'class', value: 'Integer' });
    expect(s.text).toBe(text.replace('String', 'Integer'));
  });

  it('toggling a boolean reprints just that node', async () => {
    const { bango } = await openProject('city');
    await bango.setText('datamodel', 'datamodel shop\n// keep me\nentity Road {\n  property name: String pk\n}\n');
    const s = await bango.applyEdit('datamodel', { kind: 'set', path: entityField, feature: 'required', value: true });
    expect(s.text).toContain('// keep me');
    expect(s.text).toMatch(/property name: String required pk/);
  });

  it('adds a top-level element with sensible defaults and a valid result', async () => {
    const { bango } = await openProject('city');
    const s = await bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' });
    expect(s.text).toContain('entity newEntity');
    expect(errors(s.problems)).toEqual([]);
  });

  it('adding a layer picks an existing entity from the other metamodel', async () => {
    const { bango } = await openProject('city');
    const s = await bango.applyEdit('gismodel', { kind: 'add', path: [], feature: 'layers', type: 'GeoJsonLayer' });
    expect(s.text).toMatch(/geojsonlayer newGeoJsonLayer entity (Road|Parcel) defaultStyle/);
  });

  it('adds and removes nested children and list items', async () => {
    const { bango, project } = await openProject('city');
    const path = [{ feature: 'entities', index: 0 }];
    const added = await bango.applyEdit('datamodel', { kind: 'add', path, feature: 'fields', type: 'PropertyField' });
    expect(added.text).toContain('property newPropertyField');
    expect(errors(added.problems)).toEqual([]);

    const removed = await bango.applyEdit('datamodel', { kind: 'remove', path: [...path, { feature: 'fields', index: 3 }] });
    expect(removed.text).toBe(project.instances.datamodel);

    const styles = await bango.applyEdit('gismodel', { kind: 'add', path: [{ feature: 'layers', index: 0 }], feature: 'availableStyles', value: 'thin' });
    expect(styles.text).toMatch(/availableStyles thin, thin/);
    expect(errors(styles.problems)).toEqual([]);
  });

  it('removing a list item through its feature and index', async () => {
    const { bango } = await openProject('city');
    await bango.applyEdit('gismodel', { kind: 'add', path: [{ feature: 'layers', index: 0 }], feature: 'availableStyles', value: 'thin' });
    const s = await bango.applyEdit('gismodel', { kind: 'remove', path: [{ feature: 'layers', index: 0 }], feature: 'availableStyles', index: 1 });
    expect(s.text).toMatch(/availableStyles thin\s*$/m);
  });

  it('refuses to remove the root and reports stale paths', async () => {
    const { bango } = await openProject('city');
    await expect(bango.applyEdit('datamodel', { kind: 'remove', path: [] })).rejects.toThrow(/root/);
    await expect(
      bango.applyEdit('datamodel', { kind: 'set', path: [{ feature: 'entities', index: 99 }], feature: 'name', value: 'x' })
    ).rejects.toThrow(/changed/);
  });

  it('edits for a metamodel that is not available are rejected with the reason', async () => {
    const { bango } = await openProject('shop');
    await expect(bango.applyEdit('gismodel', { kind: 'add', path: [], feature: 'layers' })).rejects.toThrow(/not part of this project/);
  });
});
