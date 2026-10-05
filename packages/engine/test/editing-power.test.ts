import { describe, expect, it } from 'vitest';
import type { TextEditDto } from '@bango/core';
import { Bango } from '../src/index.js';
import { History } from '../src/core/history.js';
import { errors, openProject } from '../../../test-support/harness.js';

/** The (0-based) line and column of the `n`th occurrence of `needle`, a character into it. */
function at(text: string, needle: string, n = 0) {
  let from = -1;
  for (let i = 0; i <= n; i++) from = text.indexOf(needle, from + 1);
  if (from < 0) throw new Error(`no '${needle}' in the text`);
  const before = text.slice(0, from + 1).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}

/** What an editor does with the edits of its own instance. */
function applyOwnEdits(text: string, edits: TextEditDto[]) {
  const lines = text.split('\n');
  const offset = (line: number, column: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + column;
  let out = text;
  for (const e of [...edits].sort((a, b) => offset(b.range.startLine, b.range.startColumn) - offset(a.range.startLine, a.range.startColumn))) {
    out = out.slice(0, offset(e.range.startLine, e.range.startColumn)) + e.newText + out.slice(offset(e.range.endLine, e.range.endColumn));
  }
  return out;
}

describe('references', () => {
  it('finds every use of an entity, in every metamodel, and its declaration', async () => {
    const { bango, project } = await openProject('city');
    const p = at(project.instances.datamodel, 'Road');
    const found = await bango.references('datamodel', project.instances.datamodel, p.line, p.column);
    expect(new Set(found.map(l => l.metamodel))).toEqual(new Set(['datamodel', 'gismodel']));
    // the declaration, the relation in Parcel, and the layer in the GIS model
    expect(found.filter(l => l.metamodel === 'datamodel').length).toBe(2);
    expect(found.filter(l => l.metamodel === 'gismodel').length).toBe(1);
  });

  it('works from a use as well as from the declaration', async () => {
    const { bango, project } = await openProject('city');
    const p = at(project.instances.gismodel, 'entity Road', 0);
    const found = await bango.references('gismodel', project.instances.gismodel, p.line, p.column + 'entity '.length);
    expect(found.length).toBe(3);
  });

  it('finds nothing where there is no symbol', async () => {
    const { bango, project } = await openProject('city');
    expect(await bango.references('datamodel', project.instances.datamodel, 0, 0)).toEqual([]);
  });
});

describe('symbols', () => {
  it('outlines the named elements of an instance', async () => {
    const { bango, project } = await openProject('city');
    const symbols = await bango.symbols('datamodel', project.instances.datamodel);
    const names = (list: typeof symbols): string[] => list.flatMap(s => [s.name, ...names(s.children)]);
    expect(names(symbols)).toEqual(expect.arrayContaining(['Road', 'Parcel', 'name', 'geometry']));
    const road = symbols.flatMap(s => [s, ...s.children]).find(s => s.name === 'Road')!;
    expect(road.range.endLine).toBeGreaterThan(road.range.startLine);
    expect(road.selectionRange.startLine).toBe(road.range.startLine);
  });
});

describe('rename', () => {
  it('renames an entity and every use of it, in every instance', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.datamodel;
    const p = at(text, 'Road');
    const result = await bango.rename('datamodel', text, p.line, p.column, 'Street');
    expect(result.error).toBeUndefined();
    // the GIS model was changed by the engine; the data model is left to its editor
    expect(result.applied).toEqual(['gismodel']);
    expect((await bango.getInstance('gismodel')).text).toContain('entity Street');
    expect((await bango.getInstance('gismodel')).text).not.toContain('Road');
    const own = result.edits.filter(e => e.metamodel === 'datamodel');
    expect(own.length).toBe(2);

    await bango.setText('datamodel', applyOwnEdits(text, own));
    for (const m of ['datamodel', 'gismodel']) expect(errors((await bango.getInstance(m)).problems), m).toEqual([]);
    expect((await bango.getInstance('datamodel')).text).toContain('entity Street');
    expect((await bango.getInstance('datamodel')).text).toContain('relation road -> Street');
  });

  it('renames from a use, which changes the declaration in the other instance', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.gismodel;
    const p = at(text, 'entity Road');
    const result = await bango.rename('gismodel', text, p.line, p.column + 'entity '.length, 'Street');
    expect(result.applied).toEqual(['datamodel']);
    expect((await bango.getInstance('datamodel')).text).toContain('entity Street');
    await bango.setText('gismodel', applyOwnEdits(text, result.edits.filter(e => e.metamodel === 'gismodel')));
    for (const m of ['datamodel', 'gismodel']) expect(errors((await bango.getInstance(m)).problems), m).toEqual([]);
  });

  it('says why when there is nothing to rename', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.datamodel;
    const keyword = await bango.rename('datamodel', text, 0, 2, 'x');
    expect(keyword.error).toMatch(/nothing to rename/);
    expect(keyword.edits).toEqual([]);
    const p = at(text, 'Road');
    expect((await bango.rename('datamodel', text, p.line, p.column, '  ')).error).toMatch(/empty/);
    expect((await bango.getInstance('gismodel')).text).toBe(project.instances.gismodel);
  });

  it('a metamodel that is not available cannot rename', async () => {
    const { bango } = await openProject('city');
    expect((await bango.rename('sensors', 'x', 0, 0, 'y')).error).toMatch(/sensors/);
  });
});

describe('quick fixes', () => {
  const UNKNOWN = (name: string) => `gismodel\ngeojsonstyle s fillColor "#fff" strokeColor "#000" fillOpacity 0.5 strokeOpacity 1.0 radius 2.0\ngeojsonlayer l entity ${name} defaultStyle s availableStyles s\n`;

  it('offers to create the entity a reference names, in the metamodel that declares entities', async () => {
    const { bango } = await openProject('city');
    const text = UNKNOWN('Nowhere');
    await bango.setText('gismodel', text);
    const p = at(text, 'Nowhere');
    const fixes = await bango.quickFixes('gismodel', text, p.line, p.column);
    expect(fixes).toEqual([{ title: "Create Entity 'Nowhere' in datamodel", metamodel: 'datamodel', type: 'Entity', name: 'Nowhere' }]);
    // nothing to fix elsewhere
    expect(await bango.quickFixes('gismodel', text, 0, 2)).toEqual([]);
  });

  it('creating it resolves the reference', async () => {
    const { bango } = await openProject('city');
    const text = UNKNOWN('Nowhere');
    await bango.setText('gismodel', text);
    expect(errors((await bango.getInstance('gismodel')).problems).join()).toMatch(/Nowhere/);
    const p = at(text, 'Nowhere');
    const [fix] = await bango.quickFixes('gismodel', text, p.line, p.column);

    const state = await bango.applyQuickFix(fix);
    expect(state.metamodel).toBe('datamodel');
    expect(state.text).toContain('entity Nowhere');
    expect(errors(state.problems)).toEqual([]);
    // the reference resolves (the new entity then has its own problems: a layer needs a geometry to draw)
    expect(errors((await bango.getInstance('gismodel')).problems).join()).not.toMatch(/Could not resolve/);
  });

  it('starts the instance of the metamodel when the project has none yet', async () => {
    const seedBango = await openProject('city');
    const bango = new Bango();
    for (const [n, t] of Object.entries(seedBango.seed.grammars)) await bango.setGrammar(n, t);
    for (const [n, c] of Object.entries(seedBango.seed.constraints)) await bango.setConstraints(n, c);
    await bango.compose(['datamodel', 'gismodel']);
    const text = UNKNOWN('Fresh');
    await bango.setText('gismodel', text);
    expect((await bango.getInstances()).map(i => i.metamodel)).toEqual(['gismodel']);

    const p = at(text, 'Fresh');
    const [fix] = await bango.quickFixes('gismodel', text, p.line, p.column);
    const state = await bango.applyQuickFix(fix);
    expect(state.text).toMatch(/entity Fresh/);
    expect(errors(state.problems)).toEqual([]);
    expect(errors((await bango.getInstance('gismodel')).problems).join()).not.toMatch(/Could not resolve/);
  });

  it('a fix that cannot be applied says why', async () => {
    const { bango } = await openProject('city');
    await expect(bango.applyQuickFix({ title: 'x', metamodel: 'sensors', type: 'SensorDef', name: 'S' })).rejects.toThrow(/sensors/);
  });
});

describe('undo and redo', () => {
  it('undoes a form edit and redoes it, restoring the text exactly', async () => {
    const { bango, project } = await openProject('shop');
    const before = (await bango.getInstance('datamodel')).text;
    expect(before).toBe(project.instances.datamodel);
    expect((await bango.getInstance('datamodel')).canUndo).toBe(false);

    const edited = await bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' });
    expect(edited.text).not.toBe(before);
    expect(edited.canUndo).toBe(true);
    expect(edited.canRedo).toBe(false);

    const undone = await bango.undo('datamodel');
    expect(undone.text).toBe(before);
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);

    const redone = await bango.redo('datamodel');
    expect(redone.text).toBe(edited.text);
    expect(redone.canRedo).toBe(false);
  });

  it('a new change after an undo forgets what could have been redone', async () => {
    const { bango } = await openProject('shop');
    await bango.applyEdit('datamodel', { kind: 'add', path: [], feature: 'entities', type: 'Entity' });
    await bango.undo('datamodel');
    const other = await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'renamed' });
    expect(other.canRedo).toBe(false);
    expect((await bango.redo('datamodel')).text).toBe(other.text);
  });

  it('steps back through several edits one at a time', async () => {
    const { bango } = await openProject('shop');
    const t0 = (await bango.getInstance('datamodel')).text;
    const t1 = (await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'one' })).text;
    const t2 = (await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'two' })).text;
    expect((await bango.undo('datamodel')).text).toBe(t1);
    expect((await bango.undo('datamodel')).text).toBe(t0);
    expect((await bango.undo('datamodel')).text).toBe(t0);
    expect((await bango.redo('datamodel')).text).toBe(t1);
    expect((await bango.redo('datamodel')).text).toBe(t2);
  });

  it('typing in quick succession is one step', async () => {
    const { bango } = await openProject('shop');
    const before = (await bango.getInstance('datamodel')).text;
    await bango.setText('datamodel', before + ' ');
    await bango.setText('datamodel', before + '  ');
    await bango.setText('datamodel', before + '   ');
    expect((await bango.undo('datamodel')).text).toBe(before);
    expect((await bango.getInstance('datamodel')).canUndo).toBe(false);
  });

  it('replacing all instances, or removing one, clears its history', async () => {
    const { bango, project } = await openProject('shop');
    await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'x' });
    expect((await bango.getInstance('datamodel')).canUndo).toBe(true);
    await bango.setInstances(project.instances);
    expect((await bango.getInstance('datamodel')).canUndo).toBe(false);
    await bango.applyEdit('datamodel', { kind: 'set', path: [], feature: 'name', value: 'y' });
    await bango.removeInstance('datamodel');
    await bango.setText('datamodel', project.instances.datamodel);
    expect((await bango.getInstance('datamodel')).canUndo).toBe(false);
  });

  it('a rename in another instance can be undone there', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.datamodel;
    const p = at(text, 'Road');
    await bango.rename('datamodel', text, p.line, p.column, 'Street');
    const undone = await bango.undo('gismodel');
    expect(undone.text).toBe(project.instances.gismodel);
  });

  it('keeps a bounded history, and coalesces by time', () => {
    const h = new History();
    for (let i = 0; i < 150; i++) h.record('m', `t${i}`, false, i);
    let n = 0;
    while (h.undo('m', 'now') !== undefined) n++;
    expect(n).toBe(100);

    const typing = new History();
    typing.record('m', 'a', true, 0);
    typing.record('m', 'ab', true, 400);     // same burst
    typing.record('m', 'abc', true, 5000);   // a pause: a new step
    expect(typing.undo('m', 'abcd')).toBe('abc');
    expect(typing.undo('m', 'abc')).toBe('a');
    expect(typing.undo('m', 'a')).toBeUndefined();
  });
});

describe('through the worker boundary', () => {
  it('results are plain data', async () => {
    const { bango, project } = await openProject('city');
    const text = project.instances.datamodel;
    const p = at(text, 'Road');
    const result = JSON.parse(JSON.stringify(await bango.rename('datamodel', text, p.line, p.column, 'Street')));
    expect(result.applied).toEqual(['gismodel']);
    expect(JSON.parse(JSON.stringify(await bango.symbols('datamodel', text)))[0].name).toBeTruthy();
  });
});
