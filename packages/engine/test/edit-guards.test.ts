import { describe, expect, it } from 'vitest';
import { errors, openProject } from '../../../test-support/harness.js';

const syntax = (problems: { message: string }[]) => problems.map(p => p.message).filter(m => /Expecting|mismatched|Unexpected|token of type/i.test(m));

describe('removing what the grammar requires', () => {
  it('the last field of an entity cannot be removed, by index or by node, and nothing changes', async () => {
    const { bango } = await openProject('shop');
    const state = await bango.getInstance('datamodel');
    const entities = state.ast!.children.entities as unknown as { children: { fields: unknown[] } }[];
    expect(entities[0].children.fields.length).toBe(3);

    // the second-to-last can go, down to one
    await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 2 }] });
    await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 1 }] });
    const one = await bango.getInstance('datamodel');
    expect(syntax(one.problems)).toEqual([]);

    await expect(bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }], feature: 'fields', index: 0 })).rejects.toThrow("'Entity' needs at least one 'fields'");
    await expect(bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 0 }] })).rejects.toThrow("needs at least one 'fields'");
    expect((await bango.getInstance('datamodel')).text).toBe(one.text);

    // the entity itself can still be removed
    const gone = await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }] });
    expect(syntax(gone.problems)).toEqual([]);
  });

  it('the last layer of a map, whose list the grammar requires, is refused the same way', async () => {
    const { bango } = await openProject('city');
    await expect(bango.applyEdit('gismodel', { kind: 'remove', path: [{ feature: 'maps', index: 0 }, { feature: 'layers', index: 0 }] })).rejects.toThrow(/needs at least one 'layers'/);
  });

  it('what is optional can be emptied: the root can lose every entity', async () => {
    const { bango } = await openProject('shop');
    for (let i = 0; i < 2; i++) {
      const state = await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }] });
      expect(syntax(state.problems)).toEqual([]);
    }
  });

  it('removing the only child of a node takes what surrounds it, so no empty braces are left behind', async () => {
    const { bango } = await openProject('portal');
    const text = 'menus portal\nmenu main {\n  item group {\n    item only opens Roads\n  }\n  item other opens main\n}\n';
    await bango.setText('menus', text);
    const state = await bango.applyEdit('menus', { kind: 'remove', path: [{ feature: 'menus', index: 0 }, { feature: 'items', index: 0 }, { feature: 'children', index: 0 }] });
    expect(syntax(state.problems)).toEqual([]);
    expect(state.text).not.toMatch(/\{\s*\}/);
    expect(state.text).toContain('item group');
    expect(state.text).toContain('item other opens main');
    // the item that lost its child is now an item that does nothing, which is a warning, not a syntax error
    expect(errors(state.problems)).toEqual([]);
    expect(state.problems.some(p => /opens nothing/.test(p.message))).toBe(true);
  });

  it('the refusal can be undone-proof: history has not recorded an edit that did not happen', async () => {
    const { bango } = await openProject('shop');
    await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 2 }] });
    await bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 1 }] });
    const before = await bango.getInstance('datamodel');
    await expect(bango.applyEdit('datamodel', { kind: 'remove', path: [{ feature: 'entities', index: 0 }, { feature: 'fields', index: 0 }] })).rejects.toThrow();
    const after = await bango.undo('datamodel');
    // one undo goes back to before the second removal, not to before a refused one
    expect(after.text).not.toBe(before.text);
    expect(after.text.split('property').length).toBeGreaterThan(before.text.split('property').length);
  });
});

describe('a new node starts from text the grammar accepts', () => {
  it('knows a sample for the values of data type rules, such as an interval bound', async () => {
    const { bango } = await openProject('gresint');
    const schema = (await bango.getFormSchema('gismodel'))!;
    const interval = schema.types.StyleInterval.fields;
    expect(interval.find(f => f.name === 'min')!.sample).toBe('0.0');
    expect(interval.find(f => f.name === 'max')!.sample).toBe('0.0');
    // plain terminals have no sample: an ID or a string is whatever the user types
    expect(schema.types.TileLayer.fields.find(f => f.name === 'url')!.sample).toBeUndefined();
    expect(schema.types.StaticIntervalsStyle.fields.find(f => f.name === 'property')!.sample).toBeUndefined();
  });

  it('adding an interval to a style gives text that parses', async () => {
    const { bango } = await openProject('gresint');
    const state = await bango.getInstance('gismodel');
    const styles = state.ast!.children.styles as { type: string }[];
    const index = styles.findIndex(s => s.type === 'StaticIntervalsStyle');
    expect(index).toBeGreaterThanOrEqual(0);
    const added = await bango.applyEdit('gismodel', { kind: 'add', path: [{ feature: 'styles', index }], feature: 'intervals', type: 'StyleInterval' });
    expect(syntax(added.problems)).toEqual([]);
    expect(added.text).toMatch(/from 0\.0 to 0\.0 style/);
  });

  it('adding an entity, a form field, a map and a menu item gives text that parses', async () => {
    const { bango } = await openProject('portal');
    const adds: [string, Parameters<typeof bango.applyEdit>[1]][] = [
      ['datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' }],
      ['forms', { kind: 'add', path: [{ feature: 'forms', index: 0 }], feature: 'fields', type: 'FormField' }],
      ['gismodel', { kind: 'add', path: [], feature: 'maps', type: 'MapDef' }],
      ['menus', { kind: 'add', path: [{ feature: 'menus', index: 0 }], feature: 'items', type: 'MenuItem' }],
      ['lists', { kind: 'add', path: [], feature: 'lists', type: 'ListDef' }]
    ];
    for (const [metamodel, op] of adds) {
      const state = await bango.applyEdit(metamodel, op);
      expect(syntax(state.problems), `${metamodel}: ${JSON.stringify(op)}`).toEqual([]);
    }
  });
});
