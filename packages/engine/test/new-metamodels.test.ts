import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@bango/core';
import { Bango } from '../src/index.js';
import { errors, openProject, warnings } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

type Json = { [key: string]: JsonValue };
const get = (json: JsonValue, ...path: string[]): JsonValue => path.reduce<JsonValue>((v, k) => (v as Json)[k], json);

describe('security: a reference to a type that three metamodels contribute to', () => {
  it('resolves grants on an entity, a form and a list in the same instance', async () => {
    const { bango } = await openProject('security-office');
    expect(errors((await bango.getInstance('security')).problems)).toEqual([]);
    const json = await bango.toJson('security');
    const kinds = (get(json!, 'data', 'security', 'permissions') as Json[]).map(p => `${p.resource}:${p.kind}`);
    expect(kinds).toEqual(['Invoice:entity', 'Customer:entity', 'Invoices:list', 'Customers:list', 'InvoiceForm:form', 'CustomerForm:form', 'Invoice:entity']);
  });

  it('still resolves when metamodels that do not know the union are composed with it, in any order (regression: the merged reflection forgot Entity is a Resource)', async () => {
    const { bango, seed } = await openProject('security-everything');
    const all = seed.projects['security-everything'];
    const permutations = [
      ['datamodel', 'browser', 'security', 'gismodel'],
      ['gismodel', 'security', 'browser', 'datamodel'],
      ['security', 'gismodel', 'sensors', 'basic', 'datamodel', 'browser'],
      ['basic', 'datamodel', 'gismodel', 'sensors', 'browser', 'security', 'menus'],
      ['menus', 'security', 'browser', 'gismodel', 'datamodel', 'basic', 'sensors']
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
    const { bango } = await openProject('security-office');
    const text = 'security office\nrole a extends b\nrole b extends a\nrole c extends a\n';
    const state = await bango.setText('security', text);
    // c extends a cycle but is not in it
    expect(errors(state.problems)).toEqual(["role 'a' extends itself", "role 'b' extends itself"]);
    expect(errors((await bango.setText('security', text.replace('role a extends b', 'role a'))).problems)).toEqual([]);
  });

  it('removing an entity breaks exactly the things that refer to it, across three metamodels', async () => {
    const { bango, project } = await openProject('security-office');
    const without = project.instances.datamodel.replace(/entity Customer[\s\S]*?\n}\n\n/, '').replace(/\n\s*relation invoices[^\n]*/, '').replace(/relation customer -> Customer inverse invoices owner/, 'property customerName: String');
    await bango.setText('datamodel', without);
    const broken = async (m: string) => errors((await bango.getInstance(m)).problems).filter(e => /Customer/.test(e)).length;
    expect(await broken('datamodel')).toBe(0);
    expect(await broken('browser')).toBeGreaterThan(0);    // CustomerForm and Customers: entity Customer
    expect(await broken('security')).toBeGreaterThan(0);   // grants on Customer, CustomerForm, Customers
  });

  it('an entity and a form with the same name: the reference resolves to one of them, always the same', async () => {
    const { bango, project } = await openProject('security-office');
    const clash = project.instances.browser.replace('form InvoiceForm entity Invoice', 'form Invoice entity Customer\n\nform InvoiceForm entity Invoice');
    await bango.setText('browser', clash);
    const kinds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await bango.setText('security', project.instances.security + 'grant viewer read on Invoice\n');
      kinds.add(String(((await bango.toJson('security')) as Json && (get((await bango.toJson('security'))!, 'data', 'security', 'permissions') as Json[]).at(-1)!.kind)));
      expect(errors((await bango.getInstance('security')).problems)).toEqual([]);
    }
    expect(kinds.size).toBe(1);
  });
});

describe('menus: recursion, and the screens of the platform', () => {
  it('opens screens, nested, and says who sees each', async () => {
    const { bango } = await openProject('portal');
    expect(errors((await bango.getInstance('menus')).problems)).toEqual([]);
    const menus = get((await bango.toJson('menus'))!, 'data', 'menus') as Json[];
    expect(menus.map(m => m.id)).toEqual(['top', 'left']);
    const top = menus[0].elements as Json[];
    expect(top[0]).toMatchObject({ id: 'Data', type: 'MENU', access: { admin: true, logged: true } });
    expect((top[0].elements as Json[]).map(i => `${(i.view as Json).component}:${(i.view as Json).view}`)).toEqual(['LIST:Roads', 'FORM:RoadForm']);
    expect(top[1]).toEqual({ id: 'overview', type: 'VIEW', view: { component: 'MAP', view: 'mapViewer' } });
  });

  it('fills the data.menus slot that basic leaves empty, and nothing else of the gresint document changes', async () => {
    const { bango, seed } = await openProject('security-everything');
    const json = await bango.toProjectJson();
    expect((get(json, 'data', 'menus') as Json[]).length).toBe(2);
    const expected = seed.expected.gresint as JsonValue;
    for (const path of [['features'], ['data', 'basicData'], ['data', 'dataModel'], ['data', 'mapViewer'], ['data', 'dataWarehouse']]) {
      expect(get(json, ...path), path.join('.')).toEqual(get(expected, ...path));
    }
    // the new parts: forms, lists, security
    expect((get(json, 'data', 'forms') as Json[]).map(f => f.id)).toEqual(['StationForm', 'ZoneForm']);
    expect((get(json, 'data', 'lists') as Json[]).map(l => l.id)).toEqual(['Stations', 'Zones']);
    expect(Object.keys(get(json, 'data', 'security') as Json)).toEqual(['roles', 'users', 'permissions']);
    // key order of the document stays the one the basic mapping lays out; what has no slot (security, the sensors, the map) comes after
    expect(Object.keys(get(json, 'data') as Json)).toEqual(['basicData', 'dataModel', 'gui', 'forms', 'lists', 'menus', 'security', 'dataWarehouse', 'mapViewer']);
  });

  it('a project without menus or security keeps the original document, empty slots included', async () => {
    const { bango, seed } = await openProject('gresint');
    expect(await bango.toProjectJson()).toEqual(seed.expected.gresint);
  });

  it('a menu needs nothing but itself: a view names the screen of the platform it opens', async () => {
    const { bango } = await openProject('menus-only');
    const state = await bango.setText('menus', 'menus\nmenu top {\n  menuview a openscreen LIST "Roads" accessBy byAdmin byLogged\n  menuview b openscreen STATIC "Home" accessBy byAnonymous\n}\n');
    expect(errors(state.problems)).toEqual([]);
    const menus = get((await bango.toJson('menus'))!, 'data', 'menus') as Json[];
    expect(menus[0].elements).toEqual([
      { id: 'a', type: 'VIEW', view: { component: 'LIST', view: 'Roads' }, access: { admin: true, logged: true } },
      { id: 'b', type: 'VIEW', view: { component: 'STATIC', view: 'Home' }, access: { anonymous: true } }
    ]);
    expect((await bango.build('menus-only')).ok).toBe(true);
  });

  it('a deeply nested menu is printed and read back', async () => {
    const { bango } = await openProject('portal');
    const deep = 'menus\nmenu main {\n  menugroup a {\n    menugroup b {\n      menugroup c {\n        menugroup d {\n          menuview e openscreen LIST "Roads"\n        }\n      }\n    }\n  }\n}\n';
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

  it('security-only is rejected, saying what to add', async () => {
    const { bango } = await openProject('security-only');
    const built = await bango.build('security-only');
    expect(built.ok).toBe(false);
    expect(built.errors.join('\n')).toMatch(/needs 'datamodel'/);
    const check = await bango.checkSelection(['security']);
    expect(check.ok).toBe(false);
    expect(check.suggested.sort()).toEqual(['browser', 'datamodel', 'security']);
  });
  it('security needs the data model and the browser; menus need nothing but the shared words', async () => {
    const bango = new Bango();
    const seed = loadSeed({ fixtures: true });
    for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
    const grammars = await bango.listMetamodels();
    const requires = (name: string) => grammars.find(g => g.name === name)!.requires.sort();
    expect(requires('security')).toEqual(['browser', 'datamodel']);
    expect(requires('menus')).toEqual([]);
    expect((await bango.checkSelection(['security'])).suggested.sort()).toEqual(['browser', 'datamodel', 'security']);
    expect((await bango.checkSelection(['menus', 'security'])).suggested.sort()).toEqual(['browser', 'datamodel', 'menus', 'security']);
  });
});
