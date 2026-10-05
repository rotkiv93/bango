import { describe, expect, it } from 'vitest';
import type { EditOp, FieldSchema, FormSchema, InstanceState } from '@bango/core';
import type { Bango } from '../src/index.js';
import { sitesOf } from '../../../test-support/edits.js';
import { openProject } from '../../../test-support/harness.js';
import { EXAMPLE_PROJECTS } from '../../../test-support/seed.js';

/** A small deterministic generator: a failure names its seed, and the same seed gives the same run on any machine. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(items: T[]) => items[Math.floor(next() * items.length)] };
}

const SYNTAX = /Expecting|mismatched|Unexpected|token of type|lexing/i;

/** One random edit of an instance, built from what its form schema says it may contain. undefined when this draw found nothing to do. */
async function randomOp(bango: Bango, state: InstanceState, schema: FormSchema, rng: ReturnType<typeof random>, counter: { n: number }): Promise<EditOp | undefined> {
  const sites = sitesOf(state.ast!);
  const kind = rng.pick(['set', 'set', 'set', 'add', 'add', 'remove']);

  if (kind === 'remove') {
    const removable = sites.filter(s => s.path.length > 0);
    return removable.length ? { kind: 'remove', path: rng.pick(removable).path } : undefined;
  }

  const site = rng.pick(sites);
  const fields = schema.types[site.node.type]?.fields ?? [];
  if (kind === 'add') {
    const slots = fields.filter(f => f.kind === 'child' && f.childTypes?.length && (f.many || !site.node.children[f.name]));
    if (!slots.length) return undefined;
    const field = rng.pick(slots);
    return { kind: 'add', path: site.path, feature: field.name, type: rng.pick(field.childTypes!) };
  }

  const settable = fields.filter(f => f.kind !== 'child');
  if (!settable.length) return undefined;
  const field = rng.pick(settable);
  const value = await valueFor(bango, field, rng, counter);
  if (field.many) {
    const current = (field.kind === 'ref' ? site.node.refs[field.name] : site.node.props[field.name]) as unknown[] | undefined;
    if (!current?.length) return undefined;
    return { kind: 'set', path: site.path, feature: field.name, index: rng.int(current.length), value };
  }
  return { kind: 'set', path: site.path, feature: field.name, value };
}

async function valueFor(bango: Bango, field: FieldSchema, rng: ReturnType<typeof random>, counter: { n: number }): Promise<string | number | boolean> {
  counter.n++;
  switch (field.kind) {
    case 'boolean': return rng.next() < 0.5;
    case 'number': return rng.int(100);
    case 'enum': return rng.pick(field.options ?? ['']);
    case 'ref': {
      const candidates = await bango.getRefCandidates(field.refType ?? '');
      return candidates.length && rng.next() < 0.7 ? rng.pick(candidates).name : `Missing${counter.n}`;
    }
    default:
      // a value of a data type rule (an interval bound) has a shape of its own: stay inside it
      if (field.sample !== undefined) return /\d/.test(field.sample) ? String(rng.int(50)) : field.sample;
      return field.quoted ? `text ${counter.n}` : `v${counter.n}`;
  }
}

/** A deeper run: FUZZ_SEEDS=1,2,3,4,5,6,7,8 FUZZ_STEPS=60 npx vitest run packages/engine/test/fuzz.test.ts */
const SEEDS = (process.env.FUZZ_SEEDS ?? '1,2,3').split(',').map(Number);
const STEPS = Number(process.env.FUZZ_STEPS ?? 25);

describe.each(EXAMPLE_PROJECTS)('random edits on %s', name => {
  it.each(SEEDS)('seed %i: every edit leaves text that parses, undo restores the original byte for byte, redo replays', async seed => {
    const { bango } = await openProject(name);
    const rng = random(seed * 7919 + name.length);
    const counter = { n: 0 };
    const instances = await bango.getInstances();
    // a couple of instances per project, different ones for each seed, so that over the three seeds all of them are touched
    const chosen = [instances[seed % instances.length], instances[(seed + 1) % instances.length]].filter((s, i, a) => a.indexOf(s) === i);

    for (const start of chosen) {
      const schema = (await bango.getFormSchema(start.metamodel))!;
      let state = await bango.getInstance(start.metamodel);
      const original = state.text;
      let applied = 0;

      for (let step = 0; step < STEPS; step++) {
        const op = await randomOp(bango, state, schema, rng, counter);
        if (!op) continue;
        const label = `${name}/${start.metamodel} seed ${seed} step ${step}: ${JSON.stringify(op)}`;
        let next: InstanceState;
        try { next = await bango.applyEdit(start.metamodel, op); } catch (e) {
          // what the grammar requires cannot be removed: refused, with a reason, and nothing changed
          if (op.kind === 'remove' && /needs (at least one )?'/.test((e as Error).message)) {
            expect((await bango.getInstance(start.metamodel)).text, label).toBe(state.text);
            continue;
          }
          throw new Error(`${label} threw: ${(e as Error).message}`);
        }
        // the text a form edit produced is always text of the language (it may break a rule, never the syntax)
        expect(next.problems.filter(p => SYNTAX.test(p.message)).map(p => p.message), label).toEqual([]);
        expect(next.ast, label).toBeDefined();
        expect(next.ast!.type, label).toBe(state.ast!.type);
        if (next.text !== state.text) applied++;
        state = next;
      }

      const final = state.text;
      let undone = 0;
      while ((await bango.getInstance(start.metamodel)).canUndo) { await bango.undo(start.metamodel); undone++; }
      expect(undone, `${name}/${start.metamodel} seed ${seed}`).toBe(applied);
      expect((await bango.getInstance(start.metamodel)).text, `${name}/${start.metamodel} seed ${seed}: undone`).toBe(original);
      while ((await bango.getInstance(start.metamodel)).canRedo) await bango.redo(start.metamodel);
      expect((await bango.getInstance(start.metamodel)).text, `${name}/${start.metamodel} seed ${seed}: redone`).toBe(final);
    }
  }, 120_000);
});
