import { describe, expect, it } from 'vitest';
import type { InstanceState } from '@bango/core';
import { openProject } from '../../../test-support/harness.js';
import { random, randomOp } from '../../../test-support/random-edits.js';
import { EXAMPLE_PROJECTS } from '../../../test-support/seed.js';

const SYNTAX = /Expecting|mismatched|Unexpected|token of type|lexing/i;

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
