import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@bango/core';
import { Bango } from '../src/index.js';
import { errors, openProject, warnings } from '../../../test-support/harness.js';

type Json = { [key: string]: JsonValue };
const get = (json: JsonValue, ...path: string[]): JsonValue => path.reduce<JsonValue>((v, k) => (v as Json)[k], json);

describe('security: a reference to a type that three metamodels contribute to', () => {
  it('resolves grants on an entity, a form and a list in the same instance', async () => {
    const { bango } = await openProject('office');
    expect(errors((await bango.getInstance('security')).problems)).toEqual([]);
    const json = await bango.toJson('security');
    const kinds = (get(json!, 'data', 'security', 'permissions') as Json[]).map(p => `${p.resource}:${p.kind}`);
    expect(kinds).toEqual(['Invoice:entity', 'Customer:entity', 'Invoices:list', 'Customers:list', 'InvoiceForm:form', 'CustomerForm:form', 'Invoice:entity']);
  });

  it('still resolves when metamodels that do not know the union are composed with it, in any order (regression: the merged reflection forgot Entity is a Resource)', async () => {
    const { bango, seed } = await openProject('everything');
    const all = seed.projects.everything;
    const permutations = [
      ['datamodel', 'forms', 'lists', 'security', 'gismodel'],
      ['gismodel', 'security', 'lists', 'forms', 'datamodel'],
      ['security', 'gismodel', 'sensors', 'basic', 'datamodel', 'forms', 'lists'],
      ['basic', 'datamodel', 'gismodel', 'sensors', 'forms', 'lists', 'security', 'menus'],
      ['menus', 'security', 'lists', 'forms', 'gismodel', 'datamodel', 'basic', 'sensors']
    ];
    for (const names of permutations) {
      await bango.compose(names);
      await bango.setInstances(Object.fromEntries(names.map(n => [n, all.instances[n]])));
      for (const s of await bango.getInstances()) expect(errors(s.problems), `${names.join('+')}: ${s.metamodel}`).toEqual([]);
      const candidates = await bango.getRefCandidates('Resource');
      expect(new Set(candidates.map(c => c.type)), names.join('+')).toEqual(new Set(['Entity', 'FormDef', 'ListDef']));
    }
  });

  it('role inheritance: a cycle is an error on each role of it, and breaking it clears them', async () => {
    const { bango } = await openProject('office');
    const text = 'security office\nrole a extends b\nrole b extends a\nrole c extends a\n';
    const state = await bango.setText('security', text);
    // c extends a cycle but is not in it
    expect(errors(state.problems)).toEqual(["role 'a' extends itself", "role 'b' extends itself"]);
    expect(errors((await bango.setText('security', text.replace('role a extends b', 'role a'))).problems)).toEqual([]);
  });

  it('removing an entity breaks exactly the things that refer to it, across three metamodels', async () => {
    const { bango, project } = await openProject('office');
    const without = project.instances.datamodel.replace(/entity Customer[\s\S]*?\n}\n\n/, '').replace(/\n\s*relation invoices[^\n]*/, '').replace(/relation customer -> Customer inverse invoices owner/, 'property customerName: String');
    await bango.setText('datamodel', without);
    const broken = async (m: string) => errors((await bango.getInstance(m)).problems).filter(e => /Customer/.test(e)).length;
    expect(await broken('datamodel')).toBe(0);
    expect(await broken('forms')).toBeGreaterThan(0);      // CustomerForm entity Customer
    expect(await broken('lists')).toBeGreaterThan(0);      // Customers entity Customer
    expect(await broken('security')).toBeGreaterThan(0);   // grants on Customer, CustomerForm, Customers
  });

  it('an entity and a form with the same name: the reference resolves to one of them, always the same', async () => {
    const { bango, project } = await openProject('office');
    const clash = project.instances.forms.replace('form InvoiceForm entity Invoice', 'form InvoiceForm entity Invoice\n\nform Invoice entity Customer');
    await bango.setText('forms', clash);
    const kinds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await bango.setText('security', project.instances.security + 'grant viewer read on Invoice\n');
      kinds.add(String(((await bango.toJson('security')) as Json && (get((await bango.toJson('security'))!, 'data', 'security', 'permissions') as Json[]).at(-1)!.kind)));
      expect(errors((await bango.getInstance('security')).problems)).toEqual([]);
    }
    expect(kinds.size).toBe(1);
  });
});

describe('menus: recursion, and a screen that is a form, a list or a map', () => {
  it('opens screens from three metamodels, nested', async () => {
    const { bango } = await openProject('portal');
    expect(errors((await bango.getInstance('menus')).problems)).toEqual([]);
    const menus = get((await bango.toJson('menus'))!, 'data', 'menus') as Json[];
    expect(menus.map(m => m.name)).toEqual(['main', 'sidebar']);
    const main = menus[0].items as Json[];
    expect(main[0]).toMatchObject({ name: 'data', label: 'Data' });
    expect((main[0].items as Json[]).map(i => `${i.target}:${i.type}`)).toEqual(['Roads:list', 'RoadForm:form']);
    expect(main[1]).toMatchObject({ name: 'overview', type: 'map', target: 'main' });
    expect(menus[1].position).toBe('side');
  });

  it('fills the data.menus slot that basic leaves empty, and nothing else of the gresint document changes', async () => {
    const { bango, seed } = await openProject('everything');
    const json = await bango.toProjectJson();
    expect((get(json, 'data', 'menus') as Json[]).length).toBe(2);
    const expected = seed.expected.gresint as JsonValue;
    for (const path of [['features'], ['data', 'basicData'], ['data', 'dataModel'], ['data', 'mapViewer'], ['data', 'dataWarehouse']]) {
      expect(get(json, ...path), path.join('.')).toEqual(get(expected, ...path));
    }
    // the new parts: forms, lists, security
    expect((get(json, 'data', 'forms') as Json[]).map(f => f.name)).toEqual(['StationForm', 'ZoneForm']);
    expect((get(json, 'data', 'lists') as Json[]).map(l => l.name)).toEqual(['Stations', 'Zones']);
    expect(Object.keys(get(json, 'data', 'security') as Json)).toEqual(['roles', 'users', 'permissions']);
    // key order of the document stays the one the basic mapping lays out; security, which no slot is left for, comes last
    expect(Object.keys(get(json, 'data') as Json)).toEqual(['basicData', 'dataModel', 'dataWarehouse', 'forms', 'lists', 'menus', 'mapViewer', 'statics', 'security']);
  });

  it('a project without menus or security keeps the original document, empty slots included', async () => {
    const { bango, seed } = await openProject('gresint');
    expect(await bango.toProjectJson()).toEqual(seed.expected.gresint);
  });

  it('a menu item that opens an entity or a missing screen is an error', async () => {
    const { bango, project } = await openProject('portal');
    const bad = project.instances.menus.replace('item edit opens RoadForm', 'item edit opens Road');
    expect(errors((await bango.setText('menus', bad)).problems).join()).toMatch(/Could not resolve reference to Screen named 'Road'/);
    // deleting the map the menus open
    await bango.setText('menus', project.instances.menus);
    const noMap = project.instances.gismodel.replace(/map main[\s\S]*$/, '');
    await bango.setText('gismodel', noMap);
    expect(errors((await bango.getInstance('menus')).problems).filter(e => /'main'/.test(e)).length).toBe(2);
  });

  it('a deeply nested menu is printed and read back', async () => {
    const { bango } = await openProject('portal');
    const deep = 'menus portal\nmenu main {\n  item a {\n    item b {\n      item c {\n        item d {\n          item e opens Roads\n        }\n      }\n    }\n  }\n}\n';
    const state = await bango.setText('menus', deep);
    expect(warnings(state.problems).length).toBe(2);
    const json = await bango.toProjectJson();
    const imported = await bango.importJson(json);
    expect(imported.errors).toEqual([]);
    await bango.setInstances({ ...Object.fromEntries((await bango.getInstances()).map(i => [i.metamodel, i.text])), ...imported.texts });
    expect(await bango.toProjectJson()).toEqual(json);
  });
});

describe('the new projects', () => {
  it.each(['office', 'portal', 'everything'])('%s builds, imports back to the same JSON, and every instance is clean', async name => {
    const { bango } = await openProject(name);
    const built = await bango.build(name);
    expect(built.ok, built.errors.join('\n')).toBe(true);
    for (const s of await bango.getInstances()) expect(errors(s.problems), `${name}/${s.metamodel}`).toEqual([]);

    const json = await bango.toProjectJson();
    const result = await bango.importJson(json);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    await bango.setInstances(result.texts);
    expect(await bango.toProjectJson()).toEqual(json);
    // and once more: a fixed point
    const again = await bango.importJson(await bango.toProjectJson());
    expect(again.texts).toEqual(result.texts);
  });

  it.each(['security-only', 'menus-only'])('%s is rejected, saying what to add', async name => {
    const { bango } = await openProject(name);
    const built = await bango.build(name);
    expect(built.ok).toBe(false);
    expect(built.errors.join('\n')).toMatch(/needs 'datamodel'/);
    const check = await bango.checkSelection([name.replace('-only', '')]);
    expect(check.ok).toBe(false);
    expect(check.suggested.length).toBeGreaterThan(3);
  });

  it('security needs the data model, the forms and the lists; menus the forms, the lists and the GIS model', async () => {
    const bango = new Bango();
    const { seed } = await openProject('shop');
    for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
    const grammars = await bango.listMetamodels();
    const requires = (name: string) => grammars.find(g => g.name === name)!.requires.sort();
    expect(requires('security')).toEqual(['datamodel', 'forms', 'lists']);
    expect(requires('menus')).toEqual(['datamodel', 'forms', 'gismodel', 'lists']);
    expect((await bango.checkSelection(['security'])).suggested.sort()).toEqual(['datamodel', 'forms', 'lists', 'security']);
    expect((await bango.checkSelection(['menus', 'security'])).suggested.sort()).toEqual(['datamodel', 'forms', 'gismodel', 'lists', 'menus', 'security']);
  });
});
