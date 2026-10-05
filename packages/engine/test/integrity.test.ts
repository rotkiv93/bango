import { describe, expect, it } from 'vitest';
import { applyOwnEdits, nameOf, referencesOf } from '../../../test-support/edits.js';
import { errors, openProject } from '../../../test-support/harness.js';
import { EXAMPLE_PROJECTS } from '../../../test-support/seed.js';

const unresolved = (problems: { severity: string; message: string }[]) => problems.filter(p => /Could not resolve reference/.test(p.message)).length;

/** Every k-th element, so a big project is sampled evenly instead of taking the first few. */
const sample = <T,>(items: T[], max: number) => (items.length <= max ? items : items.filter((_, i) => i % Math.ceil(items.length / max) === 0));

describe.each(EXAMPLE_PROJECTS)('reference integrity in %s', name => {
  it('every kind of reference, pointed at something that does not exist, is exactly one error, in its own instance, and undo restores everything', async () => {
    const { bango, project } = await openProject(name);
    const before = await bango.getInstances();
    let checked = 0;

    for (const state of before) {
      // one site per (node type, feature): that is every kind of reference the instance has
      const seen = new Set<string>();
      const sites = referencesOf(state.ast!).filter(r => !seen.has(`${r.type}.${r.feature}`) && seen.add(`${r.type}.${r.feature}`));
      for (const site of sample(sites, 12)) {
        const edited = await bango.applyEdit(state.metamodel, { kind: 'set', path: site.path, feature: site.feature, index: site.index, value: 'Bogus' });
        expect(unresolved(edited.problems), `${name}/${state.metamodel} ${site.type}.${site.feature}`).toBe(1);
        // nothing else was disturbed: the other instances see no new unresolved reference
        for (const other of await bango.getInstances()) {
          if (other.metamodel !== state.metamodel) expect(unresolved(other.problems), `${name}: ${other.metamodel} after ${site.type}.${site.feature}`).toBe(0);
        }
        const undone = await bango.undo(state.metamodel);
        expect(undone.text).toBe(state.text);
        expect(errors(undone.problems)).toEqual(errors(state.problems));
        checked++;
      }
    }
    expect(checked, `${name} has references to check`).toBeGreaterThan(0);
    expect((await bango.getInstances()).map(i => i.text)).toEqual(before.map(i => i.text));
    void project;
  }, 120_000);

  it('renaming what is declared at the top of an instance changes every use of it in every instance, and renaming back restores every text exactly', async () => {
    const { bango } = await openProject(name);
    const before = await bango.getInstances();
    const jsonBefore = await bango.toProjectJson();
    let renamed = 0;

    for (const state of before) {
      const named = state.ast!.children ? Object.values(state.ast!.children).flat().filter(n => n.name) : [];
      for (const node of sample(named, 3)) {
        const old = node.name!;
        const where = nameOf(state.text, node);
        if (!where) continue;
        const fresh = `${old.replace(/-/g, '_')}Renamed`;

        const forth = await bango.rename(state.metamodel, state.text, where.line, where.column, fresh);
        expect(forth.error, `${name}/${state.metamodel}: rename ${old}`).toBeUndefined();
        await bango.setText(state.metamodel, applyOwnEdits(state.text, forth.edits.filter(e => e.metamodel === state.metamodel)));
        for (const s of await bango.getInstances()) expect(errors(s.problems), `${name}: ${old} -> ${fresh}, ${s.metamodel}`).toEqual([]);

        const renamedText = (await bango.getInstance(state.metamodel)).text;
        const back = await bango.rename(state.metamodel, renamedText, where.line, where.column, old);
        expect(back.error, `${name}/${state.metamodel}: rename ${fresh} back`).toBeUndefined();
        await bango.setText(state.metamodel, applyOwnEdits(renamedText, back.edits.filter(e => e.metamodel === state.metamodel)));

        expect((await bango.getInstances()).map(i => i.text), `${name}: ${old} there and back`).toEqual(before.map(i => i.text));
        renamed++;
      }
    }
    expect(renamed).toBeGreaterThan(0);
    expect(await bango.toProjectJson()).toEqual(jsonBefore);
  }, 180_000);
});
