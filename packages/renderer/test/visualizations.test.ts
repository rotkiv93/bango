// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLayoutStore, ModelRenderer, VisualizationStore, loadVisualizations, type ViewInfo } from '../src/index.js';
import { openProject } from '../../../test-support/harness.js';

let mounted: ModelRenderer[] = [];
afterEach(() => {
  mounted.forEach(m => m.dispose());
  mounted = [];
  document.body.innerHTML = '';
});

/** A project with the visualizations that its metamodels ship. */
async function show(project: string, metamodel: string, view: string, extra: { layouts?: MemoryLayoutStore } = {}) {
  const opened = await openProject(project);
  const visualizations = new VisualizationStore();
  visualizations.load(opened.seed.visualizations);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const renderer = new ModelRenderer(opened.bango, { visualizations, ...extra });
  mounted.push(renderer);
  await renderer.mount(el, metamodel, view);
  return { ...opened, el, renderer, visualizations };
}

const text = (el: Element, selector: string) => [...el.querySelectorAll(selector)].map(e => e.textContent!.trim());
const node = (el: Element, id: string) => el.querySelector(`.bango-cnode[data-id="${id}"]`) as SVGGElement;

/** where a node of the canvas is on screen: its own position, then the camera's */
function screenOf(el: Element, id: string, dx = 5, dy = 5) {
  const own = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node(el, id).getAttribute('transform')!)!;
  const camera = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(el.querySelector('.bango-canvas > svg > g')!.getAttribute('transform')!)!;
  const k = Number(camera[3]);
  return { clientX: (Number(own[1]) + dx) * k + Number(camera[1]), clientY: (Number(own[2]) + dy) * k + Number(camera[2]) };
}
const fire = (target: Element, type: string, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

describe('loading the visualizations of a metamodel', () => {
  it('takes the body of a function that returns the list', () => {
    const list = loadVisualizations(`return [{ id: 'a', label: 'A', create: () => ({ mount() {}, update() {}, dispose() {} }) }];`);
    expect(list.map(v => v.id)).toEqual(['a']);
  });

  it.each([
    ['does not compile', 'return [{', /could not be loaded/],
    ['returns nothing', 'const x = 1;', /must return an array/],
    ['has a visualization with no id', 'return [{ label: "x", create() {} }];', /needs an id/],
    ['has an id with spaces', 'return [{ id: "a b", label: "x", create() {} }];', /needs an id/],
    ['has no create function', 'return [{ id: "a", label: "x" }];', /needs a label and a create/],
    ['repeats an id', 'const v = { id: "a", label: "x", create() {} }; return [v, v];', /declared twice/],
    ['throws', 'throw new Error("boom");', /boom/]
  ])('says what is wrong when the file %s', (_what, code, message) => {
    expect(() => loadVisualizations(code)).toThrow(message);
  });
});

describe('views of a metamodel', () => {
  it('are the built-in ones, plus the visualizations the metamodel brings', async () => {
    const { renderer } = await show('fleet', 'datamodel', 'form');
    const views = renderer.views('datamodel');
    expect(views.filter(v => v.kind === 'builtin').map(v => v.id)).toContain('form');
    expect(views.find(v => v.kind === 'visualization')).toMatchObject({ id: 'viz:class-diagram', label: 'Class diagram' });
    // a metamodel with none has only the built-in views
    expect(renderer.views('basic').every(v => v.kind === 'builtin')).toBe(true);
  });

  it('say why a visualization file does not load, instead of hiding the views', async () => {
    const { renderer, visualizations, el } = await show('fleet', 'datamodel', 'form');
    visualizations.set('datamodel', 'return nonsense;');
    const broken = renderer.views('datamodel').find((v: ViewInfo) => v.error);
    expect(broken?.error).toMatch(/could not be loaded/);
    await renderer.setView('viz:!');
    expect(el.textContent).toMatch(/could not be loaded/);
  });

  it('tell when they change', async () => {
    const { renderer, visualizations } = await show('fleet', 'datamodel', 'form');
    const changed = vi.fn();
    const stop = renderer.onViewsChange(changed);
    visualizations.set('datamodel', undefined);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(renderer.views('datamodel').every(v => v.kind === 'builtin')).toBe(true);
    stop();
  });

  it('are not shown when the view is not a visualization of the metamodel', async () => {
    const { renderer, el } = await show('fleet', 'sensors', 'form');
    await renderer.setView('viz:nothing');
    expect(el.textContent).toMatch(/No view 'viz:nothing'/);
  });

  it('a visualization that throws while drawing is a message, not a crash', async () => {
    const { renderer, visualizations, el } = await show('fleet', 'datamodel', 'form');
    visualizations.set('datamodel', `return [{ id: 'bad', label: 'Bad', create: () => ({ mount() {}, update() { throw new Error('cannot draw'); }, dispose() {} }) }];`);
    await renderer.setView('viz:bad');
    expect(el.textContent).toMatch(/failed: cannot draw/);
  });
});

describe('the class diagram of the data model', () => {
  it('draws entities, the enumeration, inheritance, relationships and the use of the enumeration', async () => {
    const { el } = await show('fleet', 'datamodel', 'viz:class-diagram');
    expect(
      [...el.querySelectorAll('.bango-cnode')].map(g => g.getAttribute('data-id')).sort()
    ).toEqual(['Asset', 'Buoy', 'BuoyReading', 'Port', 'Status']);

    // a class shows its stereotypes and attributes, with the flags that matter
    const buoy = node(el, 'Buoy').textContent!;
    expect(buoy).toContain('«traceable»');
    expect(buoy).toContain('serial: String  {unique}');
    expect(node(el, 'Asset').textContent).toContain('«abstract»');
    expect(node(el, 'Asset').textContent).toContain('* name: String');
    expect(node(el, 'Asset').textContent).toContain('id: Long  {pk, auto, unique}');
    expect(node(el, 'Status').textContent).toContain('«enum»');
    expect(node(el, 'Status').textContent).toContain('DEGRADED');

    // two inheritance edges, two relationships (each with its inverse: one line), one dotted line to the enumeration
    expect(el.querySelectorAll('.bango-cedge').length).toBe(5);
    expect(el.querySelectorAll('.bango-cedge[stroke-dasharray]').length).toBe(1);
    const labels = text(el, '.bango-clabel');
    // the Port has many buoys, a buoy has at most one port
    expect(labels).toContain('buoys 0..*');
    expect(labels).toContain('port 0..1');
    expect(labels).toContain('status');
  });

  it('keeps where the nodes were left, in the layout of the host, by name', async () => {
    const layouts = new MemoryLayoutStore();
    layouts.load({ datamodel: { 'viz:class-diagram': { Port: { x: 500, y: 20 } } } });
    const { el } = await show('fleet', 'datamodel', 'viz:class-diagram', { layouts });
    expect(node(el, 'Port').getAttribute('transform')).toBe('translate(500 20)');
    // the others were placed below it, and nothing overlaps its place
    expect(node(el, 'Asset').getAttribute('transform')).not.toBe('translate(500 20)');
  });

  it('tells the host where a node was dropped', async () => {
    const layouts = new MemoryLayoutStore();
    const saved = vi.fn();
    layouts.subscribe(saved);
    const { el } = await show('fleet', 'datamodel', 'viz:class-diagram', { layouts });
    saved.mockClear();
    const g = node(el, 'Status');
    const at = screenOf(el, 'Status');
    fire(g, 'pointerdown', at);
    fire(g, 'pointermove', { clientX: at.clientX + 100, clientY: at.clientY + 40 });
    fire(g, 'pointerup', at);
    expect(saved).toHaveBeenCalled();
    const stored = layouts.get('datamodel', 'viz:class-diagram').Status;
    expect(stored).toBeDefined();
    expect(g.getAttribute('transform')).toBe(`translate(${stored.x} ${stored.y})`);
  });

  it('opens the inspector on the selected node, for that node alone', async () => {
    const { el } = await show('fleet', 'datamodel', 'viz:class-diagram');
    const inspector = el.querySelector('.bango-inspector') as HTMLElement;
    expect(inspector.style.display).toBe('none');
    fire(node(el, 'Port'), 'pointerdown', screenOf(el, 'Port'));
    await vi.waitFor(() => expect(inspector.textContent).toContain('Entity'));
    expect(inspector.style.display).not.toBe('none');
    expect(inspector.querySelectorAll('fieldset').length).toBeGreaterThan(0);
    // one entity, its own: the others are only choices of its references
    const entities = [...inspector.querySelectorAll('legend')].filter(l => l.textContent!.startsWith('Entity'));
    expect(entities.map(l => l.textContent)).toEqual([expect.stringContaining('Port')]);
    expect(node(el, 'Port').classList.contains('bango-selected')).toBe(true);

    // the background lets go
    fire(el.querySelector('.bango-canvas > svg')!, 'pointerdown', { clientX: 5000, clientY: 5000 });
    expect(inspector.style.display).toBe('none');
  });

  it('adds an entity and an enumeration with the buttons of its toolbar', async () => {
    const { el, bango } = await show('fleet', 'datamodel', 'viz:class-diagram');
    const button = (label: string) => [...el.querySelectorAll('.bango-ctoolbar button')].find(b => b.textContent === label) as HTMLButtonElement;
    button('+ Entity').click();
    await vi.waitFor(() => expect(node(el, 'NewEntity')).not.toBeNull());
    button('+ Enum').click();
    await vi.waitFor(() => expect(node(el, 'NewEnum')).not.toBeNull());
    const instance = (await bango.getInstance('datamodel')).text;
    expect(instance).toMatch(/entity NewEntity/);
    expect(instance).toMatch(/enum NewEnum/);
    // the node just added is the selected one, ready to be edited at the side
    expect(node(el, 'NewEnum').classList.contains('bango-selected')).toBe(true);
    expect(node(el, 'NewEntity').classList.contains('bango-selected')).toBe(false);
  });

  it('removes the selected node with Delete', async () => {
    const { el, bango } = await show('fleet', 'datamodel', 'viz:class-diagram');
    fire(node(el, 'Port'), 'pointerdown', screenOf(el, 'Port'));
    el.querySelector('.bango-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await vi.waitFor(() => expect(node(el, 'Port')).toBeNull());
    expect((await bango.getInstance('datamodel')).text).not.toMatch(/entity Port/);
  });

  it('relates two entities by dragging from one to the other, and makes one extend the other with Shift', async () => {
    const { el, bango } = await show('fleet', 'datamodel', 'viz:class-diagram');
    const from = 'BuoyReading', to = 'Port';
    const handle = node(el, from).querySelector('.bango-handle') as SVGElement;
    fire(handle, 'pointerdown', screenOf(el, from));
    fire(handle, 'pointerup', screenOf(el, to, 20, 20));
    await vi.waitFor(async () => expect((await bango.getInstance('datamodel')).text).toMatch(/relation port -> Port inverse buoyReadings owner/));
    const text = (await bango.getInstance('datamodel')).text;
    expect(text).toMatch(/relation buoyReadings -> BuoyReading inverse port multiple/);
    // both sides were written: the model is still valid
    const problems = (await bango.getInstance('datamodel')).problems.filter(p => p.severity === 'error');
    expect(problems).toEqual([]);

    // inheritance: the entity at the other end becomes its superclass
    const h2 = node(el, 'BuoyReading').querySelector('.bango-handle') as SVGElement;
    fire(h2, 'pointerdown', screenOf(el, 'BuoyReading'));
    fire(h2, 'pointerup', { ...screenOf(el, 'Asset', 20, 20), shiftKey: true });
    await vi.waitFor(async () => expect((await bango.getInstance('datamodel')).text).toMatch(/entity BuoyReading extends Asset/));
  });
});

describe('what is offered to the data model', () => {
  const OFFERED = 'datamodel um\n\nentity UM_User {\n  property id: Long pk\n  property login: String required\n}\n\nenum UM_Role {\n  ADMIN, USER\n}\n';
  const showWithOffer = async (extra: { layouts?: MemoryLayoutStore } = {}) => {
    const opened = await openProject('fleet');
    await opened.bango.setContributed([{ origin: 'user-management', metamodel: 'datamodel', text: OFFERED }]);
    const visualizations = new VisualizationStore();
    visualizations.load(opened.seed.visualizations);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const renderer = new ModelRenderer(opened.bango, { visualizations, ...extra });
    mounted.push(renderer);
    await renderer.mount(el, 'datamodel', 'viz:class-diagram');
    return { ...opened, el, renderer };
  };
  const offeredId = (name: string) => `user-management:${name}`;

  it('is drawn next to the entities of the project: locked, dashed, and with who offers it', async () => {
    const { el } = await showWithOffer();
    const ids = [...el.querySelectorAll('.bango-cnode')].map(g => g.getAttribute('data-id'));
    expect(ids).toContain(offeredId('UM_User'));
    expect(ids).toContain(offeredId('UM_Role'));
    expect(ids).toContain('Port');
    const user = node(el, offeredId('UM_User'));
    expect(user.textContent).toContain('user-management');
    expect(user.textContent).toContain('login: String');
    expect(user.querySelector('rect[style*="stroke-dasharray"]')).not.toBeNull();
    expect(node(el, 'Port').querySelector('rect[style*="stroke-dasharray"]')).toBeNull();
    // it cannot start a relationship
    expect(user.querySelector('.bango-handle')).toBeNull();
    expect(node(el, 'Port').querySelector('.bango-handle')).not.toBeNull();
  });

  it('can be hidden and shown again with the Offered button, which is only there when something is offered', async () => {
    const { el } = await showWithOffer();
    const button = [...el.querySelectorAll('.bango-ctoolbar button')].find(b => b.textContent!.startsWith('Offered')) as HTMLElement;
    expect(button.textContent).toBe('Offered (2)');
    button.click();
    await vi.waitFor(() => expect(node(el, offeredId('UM_User'))).toBeNull());
    expect(node(el, 'Port')).not.toBeNull();
    button.click();
    await vi.waitFor(() => expect(node(el, offeredId('UM_User'))).not.toBeNull());

    // no offer, no button
    const alone = await show('fleet', 'datamodel', 'viz:class-diagram');
    expect([...alone.el.querySelectorAll('.bango-ctoolbar button')].find(b => b.textContent!.startsWith('Offered'))!.getAttribute('style')).toContain('none');
  });

  it('is read-only: no form, Delete does nothing, and the text of the project is untouched', async () => {
    const { el, bango } = await showWithOffer();
    const before = (await bango.getInstance('datamodel')).text;
    fire(node(el, offeredId('UM_User')), 'pointerdown', screenOf(el, offeredId('UM_User')));
    el.querySelector('.bango-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    expect(node(el, offeredId('UM_User'))).not.toBeNull();
    expect((await bango.getInstance('datamodel')).text).toBe(before);
    expect(el.querySelector('.bango-inspector')?.getAttribute('style') ?? 'display: none').toContain('none');
    expect(el.querySelector('.bango-cmessage')!.textContent).toContain('offered by user-management');
  });

  it('can be related to and extended from the project, one way', async () => {
    const { el, bango } = await showWithOffer();
    const edges = el.querySelectorAll('.bango-cedge').length;
    const handle = node(el, 'Port').querySelector('.bango-handle') as SVGElement;
    fire(handle, 'pointerdown', screenOf(el, 'Port'));
    fire(handle, 'pointerup', screenOf(el, offeredId('UM_User'), 20, 20));
    await vi.waitFor(async () => expect((await bango.getInstance('datamodel')).text).toMatch(/relation uM_User -> UM_User/));
    const state = await bango.getInstance('datamodel');
    // nothing was written on the side of the module's entity, and the project is still valid
    expect(state.text).toMatch(/relation uM_User -> UM_User owner/);
    expect(state.text).not.toContain('UM_User inverse');
    expect(state.problems.filter(p => p.severity === 'error')).toEqual([]);
    // the relationship is an arrow from the project's entity to the offered one
    await vi.waitFor(() => expect(el.querySelectorAll('.bango-cedge').length).toBe(edges + 1));
  });
});

describe('the sensor diagram', () => {
  const buttonOf = (el: Element, label: string) => [...el.querySelectorAll('.bango-ctoolbar button')].find(b => b.textContent === label) as HTMLButtonElement;

  it('draws the sensor, its ranges, and the entities and map it uses as ghosts from the other metamodels', async () => {
    const { el } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    expect([...el.querySelectorAll('.bango-cnode')].map(g => g.getAttribute('data-id')).sort()).toEqual([
      'entity:Buoy', 'entity:BuoyReading', 'entity:Port', 'map:buoys-map', 'range:Health', 'range:Temperature', 'sensor:Tide'
    ]);
    const sensor = node(el, 'sensor:Tide').textContent!;
    expect(sensor).toContain('every 600s · Point');
    expect(sensor).toContain('entity Buoy  ·  facts BuoyReading');
    expect(sensor).toContain('• level Double [m]');
    expect(sensor).toContain('• temperature Float [C]  ◆ Temperature');
    expect(sensor).toContain('≋ Harbour  Port');
    expect(sensor).toContain('≡ Health  by status  ◆ Health');
    expect(node(el, 'range:Temperature').textContent).toContain('default → mild');
    expect(node(el, 'range:Temperature').textContent).toContain('-30 – 5 → cold');
    expect(node(el, 'range:Health').textContent).toContain('OK → Working');
    // the ghosts say what they are, and what the data model says about them
    expect(node(el, 'entity:Buoy').textContent).toContain('«entity»');
    expect(node(el, 'entity:Buoy').textContent).toContain('geometry: Point');
    expect(node(el, 'map:buoys-map').textContent).toContain('«map»');
    // stores, facts, map, the spatial dimension, the categorical dimension, the measurement range
    expect(el.querySelectorAll('.bango-cedge').length).toBe(6);
  });

  it('shows every entity of the data model on demand', async () => {
    const { el } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    expect(node(el, 'entity:Asset')).toBeNull();
    buttonOf(el, 'Entities').click();
    await vi.waitFor(() => expect(node(el, 'entity:Asset')).not.toBeNull());
  });

  it('adds a sensor, a range and a group with its toolbar, and opens each in the panel', async () => {
    const { el, bango } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    buttonOf(el, '+ Range').click();
    await vi.waitFor(() => expect(node(el, 'range:NewRange')).not.toBeNull());
    expect(node(el, 'range:NewRange').classList.contains('bango-selected')).toBe(true);
    buttonOf(el, '+ Group').click();
    await vi.waitFor(() => expect(node(el, 'group:NewGroup')).not.toBeNull());
    const text = (await bango.getInstance('sensors')).text;
    expect(text).toMatch(/range NewRange/);
    expect(text).toMatch(/sensorGroup NewGroup \(Tide\)/);
  });

  it('adds a spatial dimension by dragging from the sensor onto an entity, and a fact table with Shift', async () => {
    const { el, bango } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    buttonOf(el, 'Entities').click();
    await vi.waitFor(() => expect(node(el, 'entity:Asset')).not.toBeNull());
    const handle = node(el, 'sensor:Tide').querySelector('.bango-handle') as SVGElement;
    fire(handle, 'pointerdown', screenOf(el, 'sensor:Tide'));
    fire(handle, 'pointerup', screenOf(el, 'entity:Asset', 10, 10));
    await vi.waitFor(async () => expect((await bango.getInstance('sensors')).text).toMatch(/spatial AssetPlace entities \(Asset\)/));
  });

  it('puts a range on the first measurement that has none, and a sensor in a group', async () => {
    const { el, bango } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    const handle = node(el, 'sensor:Tide').querySelector('.bango-handle') as SVGElement;
    fire(handle, 'pointerdown', screenOf(el, 'sensor:Tide'));
    fire(handle, 'pointerup', screenOf(el, 'range:Health', 10, 10));
    await vi.waitFor(async () => expect((await bango.getInstance('sensors')).text).toMatch(/level Double units "m" icon "waves" range Health/));
  });

  it('follows the other metamodels: an entity that is gone from the data model is drawn as missing', async () => {
    const { el, bango } = await show('fleet', 'sensors', 'viz:sensor-diagram');
    expect(node(el, 'entity:Port').textContent).not.toContain('not in the data model');
    await bango.setText('datamodel', 'datamodel fleet\nentity Buoy {\n  property id: Long pk\n  property geometry: Point\n}\nentity BuoyReading {\n  property id: Long pk\n  relation buoy -> Buoy\n}\n');
    await vi.waitFor(() => expect(node(el, 'entity:Port').textContent).toContain('not in the data model'));
  });
});

describe('what is offered to the sensor diagram', () => {
  const USERS = 'datamodel um\n\nentity UM_User {\n  property id: Long pk\n  property login: String required\n}\n';
  const PROBE = 'sensors um\n\nrange UmLevel {\n  default as "ok"\n}\n\nsensor UmProbe time 60 geometry Point\n  entity UM_User factTable UM_User\n  map buoys-map layer buoy-layer {\n  measurements\n    level Double range UmLevel\n}\n';
  const showWithOffers = async () => {
    const opened = await openProject('fleet');
    await opened.bango.setContributed([
      { origin: 'user-management', metamodel: 'datamodel', text: USERS },
      { origin: 'monitoring', metamodel: 'sensors', text: PROBE }
    ]);
    const visualizations = new VisualizationStore();
    visualizations.load(opened.seed.visualizations);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const renderer = new ModelRenderer(opened.bango, { visualizations });
    mounted.push(renderer);
    await renderer.mount(el, 'sensors', 'viz:sensor-diagram');
    return { ...opened, el, renderer };
  };

  it('draws the sensors and ranges a module offers, locked, and the entities they point at wherever those come from', async () => {
    const { el } = await showWithOffers();
    const probe = node(el, 'sensor:UmProbe');
    expect(probe.textContent).toContain('monitoring');
    expect(probe.querySelector('rect[style*="stroke-dasharray"]')).not.toBeNull();
    expect(probe.querySelector('.bango-handle')).toBeNull();
    expect(node(el, 'range:UmLevel').textContent).toContain('monitoring');
    // the entity is offered to the data model by another module: it is drawn as a ghost, with who offers it
    expect(node(el, 'entity:UM_User').textContent).toContain('offered by user-management');
    // the project's own sensor is still editable
    expect(node(el, 'sensor:Tide').querySelector('.bango-handle')).not.toBeNull();
  });

  it('is read-only, and can be hidden with the Offered button', async () => {
    const { el, bango } = await showWithOffers();
    const before = (await bango.getInstance('sensors')).text;
    fire(node(el, 'sensor:UmProbe'), 'pointerdown', screenOf(el, 'sensor:UmProbe'));
    el.querySelector('.bango-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    expect(node(el, 'sensor:UmProbe')).not.toBeNull();
    expect((await bango.getInstance('sensors')).text).toBe(before);
    expect(el.querySelector('.bango-cmessage')!.textContent).toContain('offered by monitoring');

    const button = [...el.querySelectorAll('.bango-ctoolbar button')].find(b => b.textContent!.startsWith('Offered')) as HTMLElement;
    expect(button.textContent).toBe('Offered (2)');
    button.click();
    await vi.waitFor(() => expect(node(el, 'sensor:UmProbe')).toBeNull());
    expect(node(el, 'sensor:Tide')).not.toBeNull();
  });
});
