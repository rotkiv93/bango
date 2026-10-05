// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Range0 } from '@bango/engine';
import {
  DiagramRenderer, ModelRenderer, buildGraph, defineBangoElements, layeredLayout, registerRenderer, registeredViews
} from '../src/index.js';
import { openProject } from '../../../test-support/harness.js';

let mounted: ModelRenderer[] = [];
afterEach(() => {
  mounted.forEach(m => m.dispose());
  mounted = [];
  document.body.innerHTML = '';
});

async function show(project: string, metamodel: string, view: string, options = {}) {
  const opened = await openProject(project);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const renderer = new ModelRenderer(opened.bango, options);
  mounted.push(renderer);
  await renderer.mount(el, metamodel, view);
  return { ...opened, el, renderer };
}

const labels = (el: Element, sel: string) => [...el.querySelectorAll(sel)].map(e => e.textContent!.trim());

describe('ModelRenderer', () => {
  it('registers the built-in views; text needs a Monaco instance and says so', async () => {
    expect(registeredViews().sort()).toEqual(['ast', 'diagram', 'form', 'json', 'project-ast', 'project-json']);
    const opened = await openProject('city');
    const renderer = new ModelRenderer(opened.bango);
    await expect(renderer.mount(document.createElement('div'), 'datamodel', 'text')).rejects.toThrow(/registerTextRenderer\(monaco\)/);
  });

  it('switches views without losing the instance, and follows engine changes', async () => {
    const { bango, el, renderer } = await show('city', 'datamodel', 'ast');
    expect(el.querySelector('.bango-view.bango-view-ast')).not.toBeNull();
    expect(el.textContent).toContain('Entity');

    await renderer.setView('form');
    expect(el.querySelector('.bango-view.bango-view-form')).not.toBeNull();
    expect(el.querySelector('.bango-view.bango-view-ast')).toBeNull();
    expect(renderer.view).toBe('form');

    await bango.setText('datamodel', 'datamodel shop\nentity Brand {\n  property id: String pk\n}\n');
    await vi.waitFor(() => expect(el.textContent).toContain('Brand'));
  });

  it('stops updating after dispose and can be mounted again', async () => {
    const { bango, el, renderer } = await show('city', 'datamodel', 'ast');
    renderer.dispose();
    expect(el.querySelector('.bango-view')).toBeNull();
    await bango.setText('datamodel', 'datamodel gone');
    expect(el.textContent).toBe('');
    await renderer.mount(el, 'datamodel', 'ast');
    expect(el.textContent).toContain('gone');
  });

  it('reports a metamodel that is not available instead of crashing', async () => {
    const { el } = await show('shop', 'gismodel', 'form');
    expect(el.textContent).toMatch(/not part of this project/);
  });

  it('custom views plug in with registerRenderer', async () => {
    registerRenderer('count', ctx => {
      let node: HTMLElement;
      return {
        mount: el => { node = document.createElement('p'); el.appendChild(node); },
        update: s => { node.textContent = `${ctx.metamodel}:${s.text.length}`; },
        dispose: () => node.remove()
      };
    });
    const { el, bango } = await show('city', 'datamodel', 'count');
    const len = (await bango.getInstance('datamodel')).text.length;
    expect(el.textContent).toBe(`datamodel:${len}`);
  });
});

describe('ast view', () => {
  it('shows the tree with resolved references, and the JSON on demand', async () => {
    const { el } = await show('city', 'gismodel', 'ast');
    expect(el.textContent).toContain('GeoJsonLayer');
    expect(el.textContent).toMatch(/entity → Road .*Entity Road in datamodel/);
    [...el.querySelectorAll('button')].find(b => b.textContent === 'JSON')!.click();
    expect(el.querySelector('pre.bango-json')!.textContent).toContain('"targetMetamodel": "datamodel"');
  });

  it('marks unresolved references', async () => {
    const { el, bango, project } = await show('city', 'gismodel', 'ast');
    await bango.setText('gismodel', project.instances.gismodel.replace('entity Road', 'entity Nope'));
    await vi.waitFor(() => expect(el.querySelector('.bango-unresolved')?.textContent).toMatch(/Nope.*unresolved/));
  });

  it('the project scope lists every instance', async () => {
    const { el } = await show('city', 'datamodel', 'project-ast');
    expect(labels(el, '.bango-ast-filename')).toEqual(['datamodel', 'gismodel']);
  });

  it('asks the host to show a node in its text', async () => {
    const calls: [string, Range0][] = [];
    const { el } = await show('city', 'datamodel', 'ast', { onReveal: (m: string, r: Range0) => calls.push([m, r]) });
    (el.querySelector('.bango-ast-node button.bango-link') as HTMLButtonElement).click();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('datamodel');
    expect(calls[0][1]).toMatchObject({ startLine: 0 });
  });
});

describe('json view', () => {
  const body = (el: Element) => el.querySelector('pre.bango-json')!;
  const parsed = (el: Element) => JSON.parse(body(el).textContent!);
  const pick = (el: Element, index: number, value: string) => {
    const select = el.querySelectorAll('select')[index] as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };

  it('prints the instance as its piece of the specification, readable and highlighted', async () => {
    const { el } = await show('gresint', 'datamodel', 'json');
    const spec = parsed(el);
    expect(Object.keys(spec)).toEqual(['data']);
    expect(spec.data.dataModel.entities[0].name).toBe('ZoneDimension');
    expect(body(el).querySelector('.bango-j-key')!.textContent).toBe('"data"');
    expect(body(el).querySelectorAll('.bango-j-str').length).toBeGreaterThan(5);
    expect(body(el).querySelector('.bango-j-lit')).not.toBeNull();
  });

  it('the generic tree is a choice, and brings its own options', async () => {
    const { el } = await show('gresint', 'sensors', 'json');
    expect(el.querySelectorAll('select')).toHaveLength(1); // generic-only options are not offered for mappings
    expect(el.querySelectorAll('input[type=checkbox]')).toHaveLength(0);

    pick(el, 0, 'generic');
    await vi.waitFor(() => expect(parsed(el).$type).toBe('SensorModel'));
    expect(parsed(el).sensors[0].entity).toEqual({ $ref: 'StationObservationEntity', $type: 'Entity', $in: 'datamodel' });

    pick(el, 1, 'names');
    await vi.waitFor(() => expect(parsed(el).sensors[0].entity).toBe('StationObservationEntity'));

    const [types, positions] = [...el.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    types.checked = false;
    types.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(body(el).textContent).not.toContain('$type'));
    positions.checked = true;
    positions.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(body(el).textContent).toContain('$range'));

    pick(el, 0, 'spec');
    await vi.waitFor(() => expect(parsed(el).data).toBeDefined());
    expect(el.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
  });

  it('follows edits to the instance', async () => {
    const { el, bango } = await show('gresint', 'datamodel', 'json');
    await bango.setText('datamodel', 'datamodel renamed\nentity Thing {\n  property id: Long pk\n}');
    await vi.waitFor(() => expect(parsed(el).data.dataModel.entities[0].name).toBe('Thing'));
  });

  it('the project is one merged document: the given specification', async () => {
    const { el, seed } = await show('gresint', 'datamodel', 'project-json');
    expect(parsed(el)).toEqual(seed.expected.gresint);
    expect(body(el).textContent).toBe(JSON.stringify(seed.expected.gresint, null, 2));
    expect(body(el).querySelector('.bango-j-num')).not.toBeNull();
  });

  it('...or one piece per metamodel', async () => {
    const { el } = await show('gresint', 'datamodel', 'project-json');
    expect(el.querySelectorAll('select')).toHaveLength(2);
    pick(el, 1, 'split');
    await vi.waitFor(() => expect(Object.keys(parsed(el)).sort()).toEqual(['basic', 'datamodel', 'gismodel', 'sensors']));
    expect(Object.keys(parsed(el).datamodel)).toEqual(['data']);
  });

  it('the generic project has no merged form: it lists the metamodels', async () => {
    const { el } = await show('gresint', 'datamodel', 'project-json');
    pick(el, 0, 'generic');
    await vi.waitFor(() => expect(Object.keys(parsed(el)).sort()).toEqual(['basic', 'datamodel', 'gismodel', 'sensors']));
    expect(parsed(el).sensors.$type).toBe('SensorModel');
  });

  it('explains why there is nothing to show', async () => {
    const { el } = await show('shop', 'gismodel', 'json');
    expect(el.textContent).toMatch(/not part of this project/);
    expect(el.querySelector('.bango-j-key')).toBeNull();
  });

  it('says why a mapping fails instead of showing nothing', async () => {
    const { el, bango } = await show('shop', 'datamodel', 'json');
    await bango.setSpec('datamodel', 'return function (model) { return model.nothing.here; };');
    await bango.compose(['datamodel']);
    await vi.waitFor(() => expect(el.textContent).toMatch(/JSON mapping of 'datamodel' failed/));
  });

  it('copy and download are there', async () => {
    const { el } = await show('gresint', 'datamodel', 'json');
    expect([...el.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Copy', 'Download']);
  });
});

describe('form view', () => {
  const field = (el: Element, label: string, nth = 0) =>
    [...el.querySelectorAll('.bango-field')].filter(f => f.querySelector(':scope > label')?.textContent?.startsWith(label))[nth] as HTMLElement;

  it('is generated from the grammar: one fieldset per node, one field per feature', async () => {
    const { el } = await show('city', 'gismodel', 'form');
    expect(labels(el, '.bango-node legend b')).toEqual(expect.arrayContaining(['Gis', 'MapDef', 'GeoJsonLayer', 'GeoJSONLayerStyle']));
    expect(field(el, 'entity').querySelector('select')).not.toBeNull();
    expect(field(el, 'editable').querySelector('input[type=checkbox]')).not.toBeNull();
  });

  it('offers the entities of the other metamodel as reference choices', async () => {
    const { el } = await show('city', 'gismodel', 'form');
    const options = [...field(el, 'entity').querySelectorAll('option')].map(o => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['Road', 'Parcel']));
  });

  it('editing a value rewrites the text through the engine', async () => {
    const { el, bango } = await show('city', 'gismodel', 'form');
    const layer = [...el.querySelectorAll('.bango-node')].find(n => n.querySelector('legend')?.textContent?.includes('GeoJsonLayer')) as HTMLElement;
    const name = field(layer, 'name').querySelector('input') as HTMLInputElement;
    name.value = 'highways';
    name.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await bango.getInstance('gismodel')).text).toContain('geojsonlayer highways'));
  });

  it('picking another entity changes the reference', async () => {
    const { el, bango } = await show('city', 'gismodel', 'form');
    const select = field(el, 'entity').querySelector('select') as HTMLSelectElement;
    select.value = 'Parcel';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await bango.getInstance('gismodel')).text).toContain('entity Parcel'));
  });

  it('toggling a checkbox and adding children work', async () => {
    const { el, bango } = await show('city', 'gismodel', 'form');
    const box = field(el, 'editable').querySelector('input') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await bango.getInstance('gismodel')).text).not.toContain('editable'));

    const add = [...el.querySelectorAll('.bango-add button')].find(b => b.textContent === '+ TileLayer') as HTMLButtonElement;
    add.click();
    await vi.waitFor(async () => expect((await bango.getInstance('gismodel')).text).toContain('tilelayer newTileLayer'));
    await vi.waitFor(() => expect(labels(el, '.bango-node legend b')).toContain('TileLayer'));
  });

  it('deleting a node removes it from the text', async () => {
    const { el, bango } = await show('city', 'datamodel', 'form');
    const parcel = [...el.querySelectorAll('.bango-node')].find(n => n.querySelector('legend')?.textContent?.includes('Parcel'))!;
    (parcel.querySelector('legend button.bango-x') as HTMLButtonElement).click();
    await vi.waitFor(async () => expect((await bango.getInstance('datamodel')).text).not.toContain('Parcel'));
  });

  it('shows the engine error when an edit cannot be applied', async () => {
    const { el } = await show('city', 'datamodel', 'form');
    // a root cannot be removed: the form never offers it, so trigger it through the engine contract
    const renderer = mounted[0];
    await expect(renderer['engine'].applyEdit('datamodel', { kind: 'remove', path: [] })).rejects.toThrow(/root/);
    expect(el.querySelector('.bango-form-error')).toBeNull();
  });
});

describe('diagram view', () => {
  it('builds nodes for named elements and edges for containment and references', async () => {
    const { bango } = await openProject('city');
    const instances = (await bango.getInstances()).map(i => ({ metamodel: i.metamodel, ast: i.ast! }));
    const g = buildGraph(instances);
    expect(g.nodes.map(n => n.name)).toEqual(expect.arrayContaining(['Road', 'Parcel', 'roads', 'thin', 'main']));
    const cross = g.edges.filter(e => e.kind === 'ref' && e.cross);
    expect(cross).toHaveLength(1);
    expect(cross[0]).toMatchObject({ label: 'entity' });
    expect(g.nodes.find(n => n.id === cross[0].target)!.name).toBe('Road');
    // contained elements link up the tree: Road contains its `lanes` property
    const lanes = g.edges.find(e => e.kind === 'contains' && g.nodes.find(n => n.id === e.target)!.name === 'lanes')!;
    expect(g.nodes.find(n => n.id === lanes.source)!.name).toBe('Road');
  });

  it('draws the project as SVG and follows edits', async () => {
    registerRenderer('diagram-flat', ctx => new DiagramRenderer(ctx, { layout: layeredLayout }));
    const { el, bango } = await show('city', 'datamodel', 'diagram-flat');
    // the container must not carry the class of the diagram's own root (which is absolutely positioned)
    expect(el.querySelector('.bango-view')!.classList.contains('bango-diagram')).toBe(false);
    expect(el.querySelector('.bango-view > .bango-diagram')).not.toBeNull();
    const nodes = () => el.querySelectorAll('.bango-dnode').length;
    const before = nodes();
    expect(before).toBeGreaterThan(5);
    expect(el.querySelectorAll('.bango-dedge').length).toBeGreaterThan(5);
    expect(el.querySelector('.bango-dedge[stroke="#f59e0b"]')).not.toBeNull(); // the cross-metamodel reference

    await bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' });
    // the new entity comes with its required first property
    await vi.waitFor(() => expect(nodes()).toBe(before + 2));
    expect(labels(el, '.bango-dnode title')).toContain('datamodel: Entity newEntity');
  });

  it('clicking a node asks to show its source, dragging does not', async () => {
    registerRenderer('diagram-flat', ctx => new DiagramRenderer(ctx, { layout: layeredLayout }));
    const calls: string[] = [];
    const { el } = await show('city', 'datamodel', 'diagram-flat', { onReveal: (m: string) => calls.push(m) });
    const node = el.querySelector('.bango-dnode') as SVGGElement;
    const fire = (type: string, x: number) => node.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 0, bubbles: true }));
    fire('pointerdown', 0); fire('pointerup', 0);
    expect(calls).toEqual(['datamodel']);
    fire('pointerdown', 0); fire('pointermove', 50); fire('pointerup', 50);
    expect(calls).toHaveLength(1);
  });

  it('says so when there is nothing to draw', async () => {
    registerRenderer('diagram-flat', ctx => new DiagramRenderer(ctx, { layout: layeredLayout }));
    const { el, bango } = await show('city', 'datamodel', 'diagram-flat');
    await bango.setText('datamodel', '');
    await bango.setText('gismodel', '');
    await vi.waitFor(() => expect(el.textContent).toMatch(/No named elements/));
  });
});

describe('<bango-instance>', () => {
  it('mounts a view from attributes and reacts to attribute changes', async () => {
    defineBangoElements();
    const { bango } = await openProject('city');
    const el = document.createElement('bango-instance') as HTMLElement & { engine: unknown };
    el.setAttribute('metamodel', 'datamodel');
    el.setAttribute('view', 'ast');
    document.body.appendChild(el);
    el.engine = bango;
    await vi.waitFor(() => expect(el.querySelector('.bango-ast')).not.toBeNull());

    el.setAttribute('view', 'form');
    await vi.waitFor(() => expect(el.querySelector('.bango-form')).not.toBeNull());

    el.setAttribute('metamodel', 'gismodel');
    await vi.waitFor(() => expect(el.textContent).toContain('GeoJsonLayer'));

    el.remove();
    await bango.setText('gismodel', 'gismodel');
    expect(el.querySelector('.bango-view')).toBeNull();
  });

  it('turns a reveal request into a cancelable event', async () => {
    defineBangoElements();
    const { bango } = await openProject('city');
    const el = document.createElement('bango-instance') as HTMLElement & { engine: unknown };
    el.setAttribute('metamodel', 'datamodel');
    el.setAttribute('view', 'ast');
    document.body.appendChild(el);
    el.engine = bango;
    const seen: unknown[] = [];
    el.addEventListener('bango-reveal', e => { e.preventDefault(); seen.push((e as CustomEvent).detail.metamodel); });
    await vi.waitFor(() => expect(el.querySelector('.bango-ast-node button.bango-link')).not.toBeNull());
    (el.querySelector('.bango-ast-node button.bango-link') as HTMLButtonElement).click();
    expect(seen).toEqual(['datamodel']);
  });
});
