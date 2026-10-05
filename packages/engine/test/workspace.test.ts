import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
// @ts-expect-error the adapter ships as a separate ESM file without a package export entry
import nodeEndpoint from '../../../node_modules/comlink/dist/esm/node-adapter.mjs';
import { connectBango } from '@bango/core/client';
import type { BangoApi } from '@bango/core';
import { Bango } from '../src/index.js';
import { serveBango } from '../src/worker/index.js';
import {
  KeyedDebouncer, MemoryStorage, WorkspaceController, validateMetamodelName, validateProjectName, workspaceFromSeed, type WorkspaceData
} from '../src/workspace/index.js';
import { errors } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

const DELAYS = { push: 10, refresh: 10, persist: 10 };

function make(options: { storage?: MemoryStorage; bango?: BangoApi; seed?: () => WorkspaceData } = {}) {
  const seed = loadSeed();
  const storage = options.storage ?? new MemoryStorage();
  const bango = options.bango ?? new Bango();
  const controller = new WorkspaceController(bango, { storage, seed: options.seed ?? (() => workspaceFromSeed(seed)), delays: DELAYS });
  return { controller, storage, bango, seed };
}

async function ready(options: Parameters<typeof make>[0] = {}) {
  const made = make(options);
  await made.controller.init();
  return made;
}

describe('workspace controller: lifecycle', () => {
  it('starts from the examples and brings the engine up to date', async () => {
    const { controller, bango } = await ready();
    const s = controller.state;
    expect(s.ready).toBe(true);
    expect(Object.keys(s.workspace.projects).sort()).toEqual(['catalog', 'city', 'gresint', 'shop']);
    expect(s.catalog.filter(g => g.extension).map(g => g.name).sort()).toEqual(['basic', 'datamodel', 'forms', 'gismodel', 'lists', 'sensors']);
    // no project is open yet: nothing is composed
    expect(s.activeProject).toBeUndefined();
    expect(s.instances).toEqual([]);
    expect((await bango.listMetamodels()).length).toBe(s.catalog.length);
  });

  it('opens a project: composes it and loads its instances', async () => {
    const { controller, seed } = await ready();
    await controller.openProject('city');
    const s = controller.state;
    expect(s.activeProject).toBe('city');
    expect(s.composition!.languages.map(l => l.name)).toEqual(['datamodel', 'gismodel']);
    expect(s.instances.map(i => i.metamodel).sort()).toEqual(['datamodel', 'gismodel']);
    for (const i of s.instances) expect(errors(i.problems), i.metamodel).toEqual([]);
    expect(s.instances.find(i => i.metamodel === 'datamodel')!.text).toBe(seed.projects.city.instances.datamodel);
  });

  it('switching projects replaces the engine instances', async () => {
    const { controller } = await ready();
    await controller.openProject('city');
    await controller.openProject('shop');
    expect(controller.state.instances.map(i => i.metamodel)).toEqual(['datamodel']);
    expect(controller.state.composition!.selection).toEqual(['datamodel']);
  });

  it('creates a project only when the composer says the metamodels fit, and says why not', async () => {
    const { controller } = await ready();
    const bad = await controller.createProject('maps', ['gismodel']);
    expect(bad).toMatchObject({ ok: false, suggested: ['gismodel', 'datamodel'] });
    expect((bad as { errors: string[] }).errors.join()).toMatch(/'gismodel' needs 'datamodel'/);
    expect(controller.state.workspace.projects.maps).toBeUndefined();

    expect(await controller.createProject('', ['datamodel'])).toMatchObject({ ok: false });
    expect(await controller.createProject('shop', ['datamodel'])).toMatchObject({ ok: false, errors: ["A project called 'shop' already exists"] });
    expect(await controller.createProject('nothing', [])).toMatchObject({ ok: false });

    // in the order of the catalog, whatever order was picked
    expect(await controller.createProject('  maps  ', ['gismodel', 'datamodel'])).toEqual({ ok: true });
    expect(controller.state.workspace.projects.maps.metamodels).toEqual(['datamodel', 'gismodel']);
    expect(controller.state.activeProject).toBe('maps');
    expect(controller.state.instances).toEqual([]);
  });

  it('changes the metamodels of the open project with the same checks, keeping instances', async () => {
    const { controller } = await ready();
    await controller.openProject('city');
    expect(await controller.setProjectMetamodels(['gismodel'])).toMatchObject({ ok: false });
    expect(controller.state.workspace.projects.city.metamodels).toEqual(['datamodel', 'gismodel']);
    expect(await controller.setProjectMetamodels(['datamodel'])).toEqual({ ok: true });
    expect(controller.state.composition!.languages.map(l => l.name)).toEqual(['datamodel']);
    // the gismodel instance is not lost, only out of the project
    expect(controller.state.workspace.projects.city.instances.gismodel).toBeDefined();
  });

  it('without an open project there is nothing to change', async () => {
    const { controller } = await ready();
    expect(await controller.setProjectMetamodels(['datamodel'])).toMatchObject({ ok: false, errors: ['No project is open'] });
  });

  it('deletes projects, closing the open one', async () => {
    const { controller } = await ready();
    await controller.openProject('city');
    await controller.deleteProject('shop');
    expect(controller.state.activeProject).toBe('city');
    expect(controller.state.workspace.projects.shop).toBeUndefined();
    await controller.deleteProject('city');
    expect(controller.state.activeProject).toBeUndefined();
    expect(controller.state.instances).toEqual([]);
    expect(controller.state.composition!.selection).toEqual([]);
  });

  it('creates, undoes and removes instances', async () => {
    const { controller } = await ready();
    await controller.openProject('city');
    await controller.removeInstance('gismodel');
    expect(controller.state.instances.map(i => i.metamodel)).toEqual(['datamodel']);
    expect(controller.state.workspace.projects.city.instances.gismodel).toBeUndefined();
    expect(await controller.createInstance('gismodel')).toEqual({ ok: true });
    expect(controller.state.instances.map(i => i.metamodel).sort()).toEqual(['datamodel', 'gismodel']);
    // the metamodel is not part of the project
    expect(await controller.createInstance('sensors')).toMatchObject({ ok: false });
  });

  it('mirrors what happens to the instances into the saved project', async () => {
    const { controller, bango } = await ready();
    await controller.openProject('shop');
    await bango.setText('datamodel', 'datamodel changed\n');
    await controller.flush();
    expect(controller.state.workspace.projects.shop.instances.datamodel).toBe('datamodel changed\n');
    expect(controller.state.instances[0].text).toBe('datamodel changed\n');

    const edited = await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'again' });
    await controller.flush();
    expect(controller.state.instances[0].canUndo).toBe(true);
    await controller.undo('datamodel');
    expect(controller.state.instances[0].text).toBe('datamodel changed\n');
    expect(edited.text).not.toBe('datamodel changed\n');
  });
});

describe('workspace controller: metamodels and scripts', () => {
  it('two grammars edited close together both reach the engine (a shared debounce loses the first)', async () => {
    const { controller, bango } = await ready();
    const { grammars } = controller.state.workspace;
    controller.editGrammar('datamodel', grammars.datamodel.replace('// Data model:', '// Data model, edited:'));
    controller.editGrammar('forms', grammars.forms.replace('// Forms:', '// Forms, edited:'));
    controller.editGrammar('lists', grammars.lists.replace('// Lists:', '// Lists, edited:'));
    await controller.flush();
    const described = Object.fromEntries((await bango.listMetamodels()).map(g => [g.name, g.description ?? '']));
    expect(described.datamodel).toMatch(/^Data model, edited:/);
    expect(described.forms).toMatch(/^Forms, edited:/);
    expect(described.lists).toMatch(/^Lists, edited:/);
    expect(controller.state.catalog.find(g => g.name === 'forms')!.description).toMatch(/^Forms, edited:/);
  });

  it('repeated edits of one file send only the last text', async () => {
    const { controller, bango } = await ready();
    const sent: string[] = [];
    const original = bango.setGrammar.bind(bango);
    bango.setGrammar = async (name: string, text: string) => { if (name === 'lists') sent.push(text); return original(name, text); };
    const base = controller.state.workspace.grammars.lists;
    for (const word of ['one', 'two', 'three']) controller.editGrammar('lists', base.replace('// Lists:', `// ${word}:`));
    await controller.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('// three:');
  });

  it('adds a metamodel from the template, and refuses bad or repeated names', async () => {
    const { controller } = await ready();
    expect(await controller.addGrammar('Billing')).toMatchObject({ ok: false });
    expect(await controller.addGrammar('datamodel')).toEqual({ ok: false, error: "A metamodel called 'datamodel' already exists" });
    expect(await controller.addGrammar('billing')).toEqual({ ok: true });
    const billing = controller.state.catalog.find(g => g.name === 'billing')!;
    expect(billing.extension).toBe('billing');
    expect(billing.problems.filter(p => p.severity === 'error')).toEqual([]);
    expect(controller.state.workspace.grammars.billing).toContain("entry Model: 'billing'");
  });

  it('a script gets its template on first use, and reaches the engine', async () => {
    const { controller, bango } = await ready();
    await controller.addGrammar('billing');
    for (const kind of ['constraints', 'spec', 'import'] as const) controller.ensureScript(kind, 'billing');
    const { workspace } = controller.state;
    expect(workspace.constraints.billing).toContain('@type {Constraints}');
    expect(workspace.specs.billing).toContain('@type {Spec}');
    expect(workspace.imports.billing).toContain('@type {Import}');
    // asking again keeps what is there
    controller.editScript('constraints', 'billing', '// mine\nreturn {};');
    controller.ensureScript('constraints', 'billing');
    expect(controller.state.workspace.constraints.billing).toBe('// mine\nreturn {};');
    await controller.flush();
    const info = await bango.compose(['billing']);
    expect(info.grammars.find(g => g.name === 'billing')!.problems.filter(p => p.severity === 'error')).toEqual([]);
    expect(info.languages.find(l => l.name === 'billing')!.canImport).toBe(true);
  });

  it('a script that does not compile is a problem of its metamodel, and the rest keeps working', async () => {
    const { controller } = await ready();
    await controller.openProject('city');
    controller.editScript('constraints', 'datamodel', 'return 42;');
    await controller.flush();
    const datamodel = controller.state.composition!.grammars.find(g => g.name === 'datamodel')!;
    expect(datamodel.problems.map(p => p.message).join()).toMatch(/datamodel\.constraints\.js/);
    expect(controller.state.instances.find(i => i.metamodel === 'gismodel')!.available).toBe(true);
  });

  it('saved test cases run against the grammar as it is now', async () => {
    const { controller } = await ready();
    const cases = controller.state.workspace.cases.datamodel;
    expect((await controller.runCases('datamodel')).every(r => r.ok)).toBe(true);
    // break the rule they test: the cases notice
    controller.editScript('constraints', 'datamodel', 'return {};');
    const results = await controller.runCases('datamodel');
    expect(results.length).toBe(cases.length);
    expect(results.filter(r => !r.ok).map(r => r.name)).toContain('a field name cannot repeat');
    controller.setCases('datamodel', [cases[0]]);
    expect(await controller.runCases('datamodel')).toHaveLength(1);
  });
});

describe('workspace controller: build and import', () => {
  it('builds the open project, seeing every edit made just before', async () => {
    const { controller, bango } = await ready();
    await controller.openProject('gresint');
    await controller.buildProject();
    expect(controller.state.build!.result.ok).toBe(true);
    expect(controller.state.building).toBe(false);

    // an edit still waiting to be sent is part of the build
    controller.editGrammar('basic', controller.state.workspace.grammars.basic.replace("entry BasicModel: 'basic'", "entry BasicModel: 'basicx'"));
    await controller.buildProject();
    expect(controller.state.build!.result.ok).toBe(false);
    expect(controller.state.build!.result.errors.join()).toMatch(/basic/);
    // the instance no longer parses with the new keyword
    expect(errors((await bango.getInstance('basic')).problems).length).toBeGreaterThan(0);
  });

  it('building without a project does nothing', async () => {
    const { controller } = await ready();
    await controller.buildProject();
    expect(controller.state.build).toBeUndefined();
  });

  it('imports JSON into the open project; instances of metamodels without a mapping stay', async () => {
    const { controller, seed } = await ready();
    await controller.openProject('gresint');
    const original = controller.state.instances.find(i => i.metamodel === 'sensors')!.text;
    controller.editScript('import', 'sensors', '');
    const preview = await controller.previewImport(seed.expected.gresint as never);
    expect(preview.skipped).toEqual(['sensors']);
    expect(Object.keys(preview.texts).sort()).toEqual(['basic', 'datamodel', 'gismodel']);
    await controller.applyImport(preview.texts);
    expect(controller.state.instances.find(i => i.metamodel === 'sensors')!.text).toBe(original);
    expect(controller.state.workspace.projects.gresint.instances.basic).toBe(preview.texts.basic);
    // previewing changed nothing by itself
    await controller.openProject('city');
    await controller.openProject('gresint');
    expect(controller.state.instances.find(i => i.metamodel === 'basic')!.text).toBe(preview.texts.basic);
  });
});

describe('workspace controller: saving', () => {
  it('saves what changes, and a new session starts from it', async () => {
    const storage = new MemoryStorage();
    const first = await ready({ storage });
    await first.controller.openProject('shop');
    first.controller.editGrammar('lists', first.controller.state.workspace.grammars.lists + '\n// mine\n');
    first.controller.setCases('forms', []);
    await first.bango.setText('datamodel', 'datamodel saved\n');
    await first.controller.flush();
    expect(storage.saved!.grammars.lists).toContain('// mine');
    expect(storage.saved!.projects.shop.instances.datamodel).toBe('datamodel saved\n');

    const second = await ready({ storage });
    expect(second.controller.state.workspace.grammars.lists).toContain('// mine');
    expect(second.controller.state.workspace.cases.forms).toEqual([]);
    await second.controller.openProject('shop');
    expect(second.controller.state.instances[0].text).toBe('datamodel saved\n');
  });

  it('a workspace saved before import mappings and test cases existed gets them from the examples', async () => {
    const seed = loadSeed();
    const old = workspaceFromSeed(seed) as Partial<WorkspaceData>;
    delete old.imports; delete old.cases; delete old.specs;
    old.grammars = { ...old.grammars, mine: 'grammar Mine\nimport \'common\'\nentry Model: \'mine\' name=ID?;\n' };
    const { controller } = await ready({ storage: new MemoryStorage(old as WorkspaceData) });
    const { workspace } = controller.state;
    expect(Object.keys(workspace.imports).sort()).toEqual(['basic', 'datamodel', 'forms', 'gismodel', 'lists', 'sensors']);
    expect(Object.keys(workspace.cases).length).toBeGreaterThan(0);
    expect(workspace.specs).toEqual({});
    // what the user had is kept
    expect(workspace.grammars.mine).toContain('Mine');
    expect(controller.state.catalog.some(g => g.name === 'mine')).toBe(true);
  });

  it('reset goes back to the examples', async () => {
    const { controller } = await ready();
    controller.editGrammar('lists', 'garbage');
    await controller.flush();
    expect(controller.state.catalog.find(g => g.name === 'lists')!.problems.length).toBeGreaterThan(0);
    await controller.reset();
    expect(controller.state.workspace.grammars.lists).toContain('grammar Lists');
    expect(controller.state.catalog.find(g => g.name === 'lists')!.problems.filter(p => p.severity === 'error')).toEqual([]);
    expect(controller.state.activeProject).toBeUndefined();
  });

  it('a grammar removed from the workspace is removed from the engine on the next sync', async () => {
    const seed = loadSeed();
    let examples = workspaceFromSeed(seed);
    const { controller, bango } = await ready({ seed: () => examples });
    expect((await bango.listMetamodels()).some(g => g.name === 'lists')).toBe(true);
    // the examples change (another version of the app): resetting drops what is gone, and the scripts that went with it
    examples = workspaceFromSeed(seed);
    delete examples.grammars.lists;
    delete examples.cases.lists;
    await controller.reset();
    expect((await bango.listMetamodels()).some(g => g.name === 'lists')).toBe(false);
    expect(controller.state.catalog.some(g => g.name === 'lists')).toBe(false);
  });
});

describe('workspace controller: observing', () => {
  it('tells subscribers about every change, and stops when they leave', async () => {
    const { controller } = await ready();
    const seen: (string | undefined)[] = [];
    const off = controller.subscribe(s => seen.push(s.activeProject));
    await controller.openProject('city');
    expect(seen.at(-1)).toBe('city');
    off();
    const count = seen.length;
    await controller.openProject('shop');
    expect(seen.length).toBe(count);
  });

  it('dispose cancels what is waiting', async () => {
    const { controller, storage } = await ready();
    await controller.flush();
    storage.saved = undefined;
    controller.editGrammar('lists', 'x');
    controller.dispose();
    await new Promise(r => setTimeout(r, 60));
    expect(storage.saved).toBeUndefined();
  });
});

describe('names', () => {
  it('metamodel names become file extensions', () => {
    expect(validateMetamodelName('billing')).toBeUndefined();
    expect(validateMetamodelName('')).toMatch(/Give/);
    expect(validateMetamodelName('Billing')).toMatch(/lowercase/);
    expect(validateMetamodelName('9lives')).toMatch(/lowercase/);
    expect(validateMetamodelName('my-model')).toMatch(/lowercase/);
    expect(validateMetamodelName('basic', ['basic'])).toMatch(/already exists/);
  });

  it('project names', () => {
    expect(validateProjectName('ship-monitoring')).toBeUndefined();
    expect(validateProjectName('   ')).toMatch(/Give/);
    expect(validateProjectName(' shop ', ['shop'])).toMatch(/already exists/);
  });
});

describe('keyed debouncer', () => {
  it('runs the last request of each key, and flush runs them now', async () => {
    const ran: string[] = [];
    const d = new KeyedDebouncer();
    d.schedule('a', 10_000, () => { ran.push('a1'); });
    d.schedule('a', 10_000, () => { ran.push('a2'); });
    d.schedule('b', 10_000, async () => { await new Promise(r => setTimeout(r, 5)); ran.push('b'); });
    expect(d.hasPending).toBe(true);
    await d.flush();
    expect(ran).toEqual(['a2', 'b']);
    expect(d.hasPending).toBe(false);
  });

  it('a failing task is reported and does not stop the others', async () => {
    const failures: unknown[] = [];
    const ran: string[] = [];
    const d = new KeyedDebouncer(e => failures.push(e));
    d.schedule('bad', 1, () => { throw new Error('boom'); });
    d.schedule('good', 1, () => { ran.push('good'); });
    await d.flush();
    expect(failures).toHaveLength(1);
    expect(ran).toEqual(['good']);
  });
});

describe('workspace controller through the worker boundary', () => {
  it('runs the same lifecycle against an engine in a worker', async () => {
    const { port1, port2 } = new MessageChannel();
    serveBango(nodeEndpoint(port1));
    const client = connectBango(nodeEndpoint(port2));
    try {
      const { controller } = await ready({ bango: client });
      await controller.openProject('city');
      expect(controller.state.instances.map(i => i.metamodel).sort()).toEqual(['datamodel', 'gismodel']);
      expect(await controller.createProject('maps', ['gismodel'])).toMatchObject({ ok: false });
      controller.editGrammar('lists', controller.state.workspace.grammars.lists.replace('// Lists:', '// Lists over the wire:'));
      controller.editGrammar('forms', controller.state.workspace.grammars.forms.replace('// Forms:', '// Forms over the wire:'));
      await controller.flush();
      const described = Object.fromEntries((await client.listMetamodels()).map(g => [g.name, g.description ?? '']));
      expect(described.lists).toMatch(/over the wire/);
      expect(described.forms).toMatch(/over the wire/);
      await controller.openProject('gresint');
      await controller.buildProject();
      expect(controller.state.build!.result.ok).toBe(true);
      const imported = await controller.previewImport(loadSeed().expected.gresint as never);
      expect(imported.errors).toEqual([]);
      controller.dispose();
    } finally {
      client.disconnect();
      port1.close();
      port2.close();
    }
  });
});

describe('the workspace entry point stays free of the parser', () => {
  it('imports nothing but @bango/core and its own files', () => {
    const dir = join(import.meta.dirname, '../src/workspace');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
        expect(m[1] === '@bango/core' || m[1].startsWith('./'), `${file} imports ${m[1]}`).toBe(true);
      }
    }
  });
});
