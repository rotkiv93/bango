import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { OTHER_GRAMMAR, OTHER_INSTANCE } from '../../../test-support/clash.js';
import { errors, warnings } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

const THINGS = `grammar Things
import 'common'

// Things: items with an optional size
entry Model: 'things' (items+=Item)*;
Item: 'item' name=ID ('size' size=INT)?;
`;
const TEXT = 'things\nitem a size 1\nitem b size 20\nitem c\n';

/** A Bango with the shared terminals and the `things` metamodel, constraints as given, and the TEXT instance set. */
async function things(constraints: string, text = TEXT) {
  const bango = new Bango();
  await bango.setGrammar('common', loadSeed().grammars.common);
  await bango.setGrammar('things', THINGS);
  await bango.setConstraints('things', constraints);
  const info = await bango.compose(['things']);
  await bango.setText('things', text);
  const state = await bango.getInstance('things');
  return { bango, info, state, messages: state.problems.map(p => p.message), setupErrors: info.grammars.find(g => g.name === 'things')!.problems.filter(p => p.severity === 'error').map(p => p.message) };
}

describe('constraints written as Langium validators', () => {
  it('bare checks keyed by type still work', async () => {
    const { messages } = await things(`return { Item(item, accept) { if (item.size > 10) accept('error', 'too big', { node: item, property: 'size' }); } };`);
    expect(messages).toEqual(['too big']);
  });

  it('a validator with a checks map: `this` is the validator, so it can have helpers and settings', async () => {
    const { messages, setupErrors } = await things(`
      return {
        limit: 10,
        describe(item) { return item.name + ' is over ' + this.limit; },
        checks: {
          Item(item, accept) { if (item.size > this.limit) accept('error', this.describe(item), { node: item, property: 'size' }); }
        }
      };`);
    expect(setupErrors).toEqual([]);
    expect(messages).toEqual(['b is over 10']);
  });

  it('a validator class instance, as in a Langium project', async () => {
    const { messages } = await things(`
      class ThingsValidator {
        constructor() { this.seen = []; }
        get checks() { return { Item: this.checkItem }; }
        checkItem(item, accept) { this.seen.push(item.name); if (!item.size) accept('warning', item.name + ' has no size', { node: item }); }
      }
      return new ThingsValidator();`);
    expect(messages).toEqual(['c has no size']);
  });

  it('the validator class itself can be returned', async () => {
    const { messages } = await things(`
      return class { constructor() { this.checks = { Item: (item, accept) => { if (item.name === 'b') accept('hint', 'found b', { node: item }); } }; } };`);
    expect(messages).toEqual(['found b']);
  });

  it('several validators in one file, each with its own category', async () => {
    const { messages, setupErrors } = await things(`
      return [
        { checks: { Item(item, accept) { if (item.size > 10) accept('error', 'fast: too big', { node: item }); } }, category: 'fast' },
        { checks: { Item(item, accept) { if (!item.size) accept('warning', 'slow: no size', { node: item }); } }, category: 'slow' },
        { Model(model, accept) { if (model.items.length > 2) accept('info', 'bare: many', { node: model }); } }
      ];`);
    expect(setupErrors).toEqual([]);
    expect(messages.sort()).toEqual(['bare: many', 'fast: too big', 'slow: no size']);
  });

  it('checks receive the cancellation token, as in Langium', async () => {
    const { messages } = await things(`return { Item(item, accept, cancel) { if (item.name === 'a') accept('hint', typeof cancel + ':' + typeof cancel.isCancellationRequested, { node: item }); } };`);
    expect(messages).toEqual(['object:boolean']);
  });

  it('a wrong category, a check that is not a function, or something that is not a validator is a problem of the metamodel', async () => {
    const bad = async (code: string) => (await things(code)).setupErrors.join();
    expect(await bad(`return { checks: {}, category: 'sometimes' };`)).toMatch(/category must be one of 'fast', 'slow', 'built-in'/);
    expect(await bad(`return { Item: 5 };`)).toMatch(/constraint 'Item' is not a function/);
    expect(await bad(`return { checks: { Item: 'x' } };`)).toMatch(/constraint 'Item' is not a function/);
    expect(await bad(`return 42;`)).toMatch(/constraints must/);
    expect(await bad(`return [1];`)).toMatch(/constraints\[0\] must|constraints must/);
    expect(await bad(`return () => 1;`)).toMatch(/constraints must/);
    expect(await bad(`throw new Error('nope');`)).toMatch(/things\.constraints\.js: nope/);
  });

  it('a check that throws is reported by Langium on the document, the others still run', async () => {
    const { state } = await things(`
      return [
        { Item() { throw new Error('check exploded'); } },
        { Item(item, accept) { if (item.name === 'c') accept('warning', 'second validator ran', { node: item }); } }
      ];`);
    expect(warnings(state.problems)).toEqual(['second validator ran']);
    expect(errors(state.problems).join()).toMatch(/check exploded/);
  });

  it('an empty constraints file, an empty array and an empty validator are fine', async () => {
    for (const code of ['return {};', 'return [];', 'return { checks: {} };']) {
      const { setupErrors, messages } = await things(code);
      expect(setupErrors, code).toEqual([]);
      expect(messages, code).toEqual([]);
    }
  });

  it('when a type name is renamed for a project, the checks follow it and the validator stays itself', async () => {
    const bango = new Bango();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await bango.setGrammar(n, t);
    await bango.setGrammar('other', OTHER_GRAMMAR);
    await bango.setConstraints('other', `
      return {
        tag: 'other',
        checks: { Entity(entity, accept) { accept('warning', this.tag + ' saw ' + typeName(entity), { node: entity, property: 'name' }); } },
        category: 'slow'
      };`);
    await bango.compose(['datamodel', 'other']);
    await bango.setText('other', OTHER_INSTANCE);
    const found = warnings((await bango.getInstance('other')).problems);
    // keyed by the new name (OtherEntity), `this` is still the validator, and `typeName` gives the name the author wrote
    expect(found).toEqual(['other saw Entity', 'other saw Entity']);
  });
});
