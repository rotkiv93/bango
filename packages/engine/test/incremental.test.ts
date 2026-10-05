import { describe, expect, it } from 'vitest';
import { Bango } from '../src/index.js';
import { feedSeed } from '../../../test-support/harness.js';
import { random, randomOp } from '../../../test-support/random-edits.js';
import { EXAMPLE_PROJECTS, loadSeed } from '../../../test-support/seed.js';

/**
 * The engine remakes only the instance documents a change can have reached (the changed one, and the metamodels that need it). This
 * holds it to the original behaviour: an engine that remakes everything every time, driven through the same changes, must say exactly
 * the same about every instance after every step.
 */
async function pair(project: string) {
  const seed = loadSeed();
  const def = seed.projects[project];
  const make = async (incremental: boolean) => {
    const bango = new Bango({ incremental });
    await feedSeed(bango, seed);
    await bango.compose(def.metamodels);
    await bango.setInstances(def.instances);
    return bango;
  };
  return { fast: await make(true), full: await make(false), def };
}

async function expectSame(fast: Bango, full: Bango, label: string) {
  const a = await fast.getInstances();
  const b = await full.getInstances();
  expect(a.map(i => i.metamodel), label).toEqual(b.map(i => i.metamodel));
  for (let i = 0; i < a.length; i++) {
    expect(a[i].text, `${label}: ${a[i].metamodel} text`).toBe(b[i].text);
    expect(a[i].problems, `${label}: ${a[i].metamodel} problems`).toEqual(b[i].problems);
    expect(JSON.stringify(a[i].ast), `${label}: ${a[i].metamodel} ast`).toBe(JSON.stringify(b[i].ast));
  }
  // the project JSON, or the reason it cannot be made (a mapping meeting a half-broken instance): the same either way
  const outcome = (bango: Bango) => bango.toProjectJson().then(value => ({ value }), (e: Error) => ({ error: e.message }));
  expect(await outcome(fast), `${label}: json`).toEqual(await outcome(full));
}

describe.each(EXAMPLE_PROJECTS)('incremental rebuild in %s', name => {
  it.each([1, 2])('seed %i: random edits, broken texts, removals and undo give what a full rebuild gives', async seed => {
    const { fast, full } = await pair(name);
    await expectSame(fast, full, `${name} start`);
    const rng = random(seed * 104729 + name.length);
    const counter = { n: 0 };

    for (let step = 0; step < 30; step++) {
      const instances = await fast.getInstances();
      const target = rng.pick(instances);
      const label = `${name} seed ${seed} step ${step} on ${target.metamodel}`;
      const draw = rng.next();

      if (draw < 0.6) {
        const schema = (await fast.getFormSchema(target.metamodel))!;
        const op = await randomOp(fast, target, schema, rng, counter);
        if (!op) continue;
        const results = await Promise.allSettled([fast.applyEdit(target.metamodel, op), full.applyEdit(target.metamodel, op)]);
        // an edit that is refused, is refused by both
        expect(results[0].status, `${label}: ${JSON.stringify(op)}`).toBe(results[1].status);
      } else if (draw < 0.75) {
        // text that does not parse, then the text back
        const broken = target.text.slice(0, Math.floor(target.text.length * rng.next()));
        await Promise.all([fast.setText(target.metamodel, broken), full.setText(target.metamodel, broken)]);
        await expectSame(fast, full, `${label} (broken text)`);
        await Promise.all([fast.setText(target.metamodel, target.text), full.setText(target.metamodel, target.text)]);
      } else if (draw < 0.85) {
        await Promise.all([fast.undo(target.metamodel), full.undo(target.metamodel)]);
      } else if (draw < 0.92) {
        await Promise.all([fast.removeInstance(target.metamodel), full.removeInstance(target.metamodel)]);
        await expectSame(fast, full, `${label} (removed)`);
        await Promise.all([fast.setText(target.metamodel, target.text), full.setText(target.metamodel, target.text)]);
      } else {
        // the same text again: nothing to do, and the same either way
        await Promise.all([fast.setText(target.metamodel, target.text), full.setText(target.metamodel, target.text)]);
      }
      await expectSame(fast, full, label);
    }
  }, 120_000);
});

describe('what incremental rebuild leaves alone', () => {
  it('editing a metamodel that nothing needs does not remake the documents of the others', async () => {
    const { fast } = await pair('office');
    const store = (fast.engine as unknown as { store: { docs: Map<string, object> } }).store;
    const before = new Map(store.docs);
    await fast.setText('security', (await fast.getInstance('security')).text + ' ');
    // security needs datamodel, forms and lists, but nothing needs security: only its own document was made again
    for (const m of ['datamodel', 'forms', 'lists']) expect(store.docs.get(m), m).toBe(before.get(m));
    expect(store.docs.get('security')).not.toBe(before.get('security'));
  });

  it('editing one that others need remakes those, and only those', async () => {
    const { fast } = await pair('office');
    const store = (fast.engine as unknown as { store: { docs: Map<string, object> } }).store;
    const before = new Map(store.docs);
    await fast.setText('forms', (await fast.getInstance('forms')).text + ' ');
    // forms is needed by security; datamodel and lists are not
    expect(store.docs.get('datamodel')).toBe(before.get('datamodel'));
    expect(store.docs.get('lists')).toBe(before.get('lists'));
    expect(store.docs.get('forms')).not.toBe(before.get('forms'));
    expect(store.docs.get('security')).not.toBe(before.get('security'));
  });

  it('editing the data model remakes everything that needs it, which is everything else here', async () => {
    const { fast } = await pair('office');
    const store = (fast.engine as unknown as { store: { docs: Map<string, object> } }).store;
    const before = new Map(store.docs);
    await fast.setText('datamodel', (await fast.getInstance('datamodel')).text + ' ');
    for (const m of ['datamodel', 'forms', 'lists', 'security']) expect(store.docs.get(m), m).not.toBe(before.get(m));
  });

  it('the same text again makes nothing again', async () => {
    const { fast } = await pair('office');
    const store = (fast.engine as unknown as { store: { docs: Map<string, object> } }).store;
    const before = new Map(store.docs);
    for (const m of ['datamodel', 'forms', 'security']) await fast.setText(m, (await fast.getInstance(m)).text);
    for (const [m, doc] of before) expect(store.docs.get(m), m).toBe(doc);
  });

  it('a new composition starts from nothing: every document is made again', async () => {
    const { fast, def } = await pair('office');
    const store = (fast.engine as unknown as { store: { docs: Map<string, object> } }).store;
    const before = new Map(store.docs);
    await fast.compose(def.metamodels);
    for (const m of def.metamodels) expect(store.docs.get(m), m).not.toBe(before.get(m));
  });
});
