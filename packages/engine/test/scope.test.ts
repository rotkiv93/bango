import { URI } from 'langium';
import { createServicesForGrammar } from 'langium/grammar';
import { describe, expect, it } from 'vitest';
import { applyOwnEdits, at } from '../../../test-support/edits.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { MetamodelScopeProvider } from '../src/core/scope.js';

const FORMS = [{ feature: 'forms', index: 0 }];
const firstField = [...FORMS, { feature: 'fields', index: 0 }];

describe('scope scripts: a reference sees what is visible where it is written', () => {
  it('the fields of a form are the fields of its entity, and no others', async () => {
    const { bango } = await openProject('office');
    const form = (await bango.getInstance('forms')).text;
    // `total` is a field of Invoice, not of Customer
    const wrong = await bango.setText('forms', form.replace('field email', 'field total'));
    expect(errors(wrong.problems)).toEqual(["Could not resolve reference to Field named 'total'."]);
    const right = await bango.setText('forms', form.replace('form InvoiceForm entity Invoice', 'form InvoiceForm entity Invoice { field total }'));
    expect(errors(right.problems)).toEqual([]);
  });

  it('a name two entities share resolves to the field of the right one', async () => {
    const { bango } = await openProject('office');
    const dm = (await bango.getInstance('datamodel')).text;
    const forms = (await bango.setText('forms', 'forms\n\nform A entity Customer { field id }\nform B entity Invoice { field id }\n')).text;
    const [a, b] = [at(forms, 'field id', 0), at(forms, 'field id', 1)];
    const target = async (line: number, column: number) => (await bango.definition('forms', forms, line, column + 6))[0];
    const [first, second] = [await target(a.line, a.column), await target(b.line, b.column)];
    expect(first.metamodel).toBe('datamodel');
    // Customer's `id` is in the first entity, Invoice's in the second
    const customerEnd = dm.split('\n').findIndex(l => l.startsWith('entity Invoice'));
    expect(first.target.startLine).toBeLessThan(customerEnd);
    expect(second.target.startLine).toBeGreaterThan(customerEnd);
  });

  it('completion offers the fields of the entity, only', async () => {
    const { bango } = await openProject('office');
    const text = 'forms\n\nform A entity Customer {\n  field \n}\n';
    const labels = (await bango.complete('forms', text, 3, 8)).map(c => c.label);
    expect(labels).toEqual(expect.arrayContaining(['id', 'name', 'email', 'invoices']));
    expect(labels).not.toContain('total');
    expect(labels).not.toContain('number');
  });

  it('a form asks what is visible from where the reference is, and the schema says which references to ask about', async () => {
    const { bango } = await openProject('office');
    const schema = (await bango.getFormSchema('forms'))!;
    expect(schema.types.FormField.fields.find(f => f.name === 'property')).toMatchObject({ kind: 'ref', refType: 'Field', scoped: true });
    expect(schema.types.FormDef.fields.find(f => f.name === 'entity')!.scoped).toBeUndefined();

    const names = async (path: typeof firstField) => (await bango.getRefCandidates('Field', { metamodel: 'forms', path, feature: 'property' })).map(c => c.name).sort();
    expect(await names(firstField)).toEqual(['email', 'id', 'invoices', 'name']);
    // the second form has no fields yet: give it one, then ask there
    await bango.applyEdit('forms', { kind: 'add', path: [{ feature: 'forms', index: 1 }], feature: 'fields', type: 'FormField' });
    expect(await names([{ feature: 'forms', index: 1 }, { feature: 'fields', index: 0 }])).toEqual(['customer', 'id', 'number', 'total']);
    // without a place, the whole project: and fields are not top-level, so there are none to list
    expect(await bango.getRefCandidates('Field')).toEqual([]);
  });

  it('a field added from a form starts with one that resolves', async () => {
    const { bango } = await openProject('office');
    const edited = await bango.applyEdit('forms', { kind: 'add', path: [{ feature: 'forms', index: 1 }], feature: 'fields', type: 'FormField' });
    expect(errors(edited.problems)).toEqual([]);
    // InvoiceForm shows Invoice: the first of its fields, not the first one of the project
    expect(edited.text).toMatch(/form InvoiceForm entity Invoice \{\s*field id\b/);
    const list = await bango.applyEdit('lists', { kind: 'add', path: [{ feature: 'lists', index: 0 }], feature: 'columns', type: 'ListColumn' });
    expect(errors(list.problems)).toEqual([]);
  });

  it('renaming a field renames every use of it, in other instances and in the JSON', async () => {
    const { bango } = await openProject('office');
    const dm = (await bango.getInstance('datamodel')).text;
    const where = at(dm, 'property total');
    const result = await bango.rename('datamodel', dm, where.line, where.column + 'property '.length, 'amount');
    expect(result.error).toBeUndefined();
    expect(result.applied).toEqual(['lists']);
    await bango.setText('datamodel', applyOwnEdits(dm, result.edits.filter(e => e.metamodel === 'datamodel')));

    for (const state of await bango.getInstances()) expect(errors(state.problems), state.metamodel).toEqual([]);
    expect((await bango.getInstance('lists')).text).toContain('column amount label "Total (EUR)"');
    const json = (await bango.toProjectJson()) as { data: { lists: { columns: { name: string }[] }[] } };
    expect(json.data.lists[0].columns.map(c => c.name)).toEqual(['number', 'amount', 'customer']);

    // and the same name in another entity is not touched
    const back = await bango.getInstance('datamodel');
    const second = at(back.text, 'property number');
    const other = await bango.rename('datamodel', back.text, second.line, second.column + 'property '.length, 'code');
    expect(other.error).toBeUndefined();
    expect(other.edits.filter(e => e.metamodel === 'forms')).toEqual([]);
  });

  it('references to a field are found from the field', async () => {
    const { bango } = await openProject('office');
    const dm = (await bango.getInstance('datamodel')).text;
    const where = at(dm, 'property number');
    const found = await bango.references('datamodel', dm, where.line, where.column + 'property '.length);
    expect(found.map(f => f.metamodel).sort()).toEqual(['datamodel', 'lists', 'lists']);
  });
});

describe('scope scripts are scripts', () => {
  it('a script that does not return a scope is reported on its metamodel, and the metamodel keeps working', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('forms', 'return 42;');
    const composition = await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    const forms = composition.grammars.find(g => g.name === 'forms')!;
    expect(forms.problems.map(p => p.message).join()).toMatch(/forms\.scope\.js: a scope must `return/);
    // without its scope the reference falls back to the default one, which cannot see fields
    expect((await bango.getInstance('forms')).available).toBe(true);
    await bango.setScope('forms', 'return { FormField: { property: 1 } };');
    expect((await bango.compose(['datamodel', 'forms'])).grammars.find(g => g.name === 'forms')!.problems.map(p => p.message).join()).toMatch(/scope 'FormField\.property' is not a function/);
  });

  it('a script that throws is a problem of the reference, not a failed call', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('forms', "return { FormField: { property() { throw new Error('the scope exploded'); } } };");
    const state = await bango.compose(['datamodel', 'forms', 'lists', 'security']).then(() => bango.getInstance('forms'));
    expect(state.available).toBe(true);
    expect(errors(state.problems).join()).toMatch(/the scope exploded|Could not resolve reference to Field/);
    expect((await bango.getInstance('lists')).available).toBe(true);
    // asking a form what is visible there answers with nothing instead of failing
    expect(await bango.getRefCandidates('Field', { metamodel: 'forms', path: firstField, feature: 'property' })).toEqual([]);
  });

  it('undefined leaves a reference to the default scope, and a list narrows it to exactly that', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('forms', 'return { FormDef: { entity: () => undefined } };');
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    expect(errors((await bango.getInstance('forms')).problems)).toEqual(["Could not resolve reference to Field named 'name'.", "Could not resolve reference to Field named 'email'."]);
    // with no scope for `property` at all, no nested field can be found: that is what the scope script is for. `entity` is still found
    expect((await bango.getInstance('forms')).problems.some(p => /Entity named/.test(p.message))).toBe(false);

    await bango.setScope('forms', 'return { FormDef: { entity: () => [] } };');
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    expect(errors((await bango.getInstance('forms')).problems).join()).toMatch(/Could not resolve reference to Entity named 'Customer'/);
  });

  it('nodes of the wrong type are ignored', async () => {
    const { bango } = await openProject('office');
    // an entity is not a field: the reference to a field cannot point at it, whatever the script says
    await bango.setScope('forms', 'return { FormField: { property: field => [field.$container.entity.ref] } };');
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    expect(errors((await bango.getInstance('forms')).problems).length).toBeGreaterThan(0);
  });

  it('a scope for a type applies to the types that extend it', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('forms', "return { FormField: { property: () => [] } };\n");
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    expect(errors((await bango.getInstance('forms')).problems)).toHaveLength(2);
  });

  it('is told where it is called: the feature, and the item of a list', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('lists', "return { ListDef: { sortBy(list, info) { if (info.property !== 'sortBy') throw new Error('wrong feature ' + info.property); return list.entity.ref.fields; } } };");
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    expect(errors((await bango.getInstance('lists')).problems).filter(m => /wrong feature/.test(m))).toEqual([]);
  });

  it('scripts run in the same scope as the others: no network, no globals', async () => {
    const { bango } = await openProject('office');
    await bango.setScope('forms', "return { FormField: { property() { return fetch('http://example.com'); } } };");
    await bango.compose(['datamodel', 'forms', 'lists', 'security']);
    // `fetch` is undefined inside a script: calling it fails, like any error of a scope script
    expect(errors((await bango.getInstance('forms')).problems).length).toBeGreaterThan(0);
  });
});

describe('scope scripts are Langium', () => {
  const GRAMMAR = `grammar Tiny
entry Model: (entities+=Entity | uses+=Use)*;
Entity: 'entity' name=ID '{' (fields+=Field)* '}';
Field: 'field' name=ID;
Use: 'use' entity=[Entity:ID] 'field' field=[Field:ID];
terminal ID: /[_a-zA-Z][\\w_]*/;
hidden terminal WS: /\\s+/;
`;

  it('the scope provider works in plain Langium services, with no Bango engine', async () => {
    const scopes = [{ Use: { field: (use: any) => use.entity?.ref?.fields ?? [] } }];
    const services = await createServicesForGrammar({
      grammar: GRAMMAR,
      module: { references: { ScopeProvider: (s: any) => new MetamodelScopeProvider(s, scopes) } },
      languageMetaData: { languageId: 'tiny', fileExtensions: ['.tiny'], caseInsensitive: false, mode: 'development' }
    });
    const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = services.shared.workspace;
    const check = async (text: string, n: number) => {
      const doc = LangiumDocumentFactory.fromString(text, URI.parse(`file:///tiny/${n}.tiny`));
      LangiumDocuments.addDocument(doc);
      await DocumentBuilder.build([doc], { validation: true });
      return (doc.diagnostics ?? []).map(d => d.message);
    };
    const model = 'entity A { field x }\nentity B { field y }\n';
    expect(await check(model + 'use A field x\nuse B field y\n', 1)).toEqual([]);
    expect(await check(model + 'use A field y\n', 2)).toEqual(["Could not resolve reference to Field named 'y'."]);
    // the same grammar without the script: a field is not exported, so none can be found
    const plain = await createServicesForGrammar({ grammar: GRAMMAR, languageMetaData: { languageId: 'tiny', fileExtensions: ['.tiny'], caseInsensitive: false, mode: 'development' } });
    const doc = plain.shared.workspace.LangiumDocumentFactory.fromString(model + 'use A field x\n', URI.parse('file:///tiny/3.tiny'));
    plain.shared.workspace.LangiumDocuments.addDocument(doc);
    await plain.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    expect((doc.diagnostics ?? []).map(d => d.message)).toEqual(["Could not resolve reference to Field named 'x'."]);
  });
});
