import { describe, expect, it } from 'vitest';
import { errors, openProject } from '../../../test-support/harness.js';

const OFFERED = `datamodel um

entity UM_User {
  property login: String required pk
}
`;

const OTHER_OFFERED = `datamodel other

entity UM_Group {
  property name: String
}
`;

const withRelation = (target: string) => `datamodel shop

entity Order {
  property code: String pk
  relation account -> ${target}
}
`;

describe('contributed instances', () => {
  it('resolve references of the project, and are reported with their origin', async () => {
    const { bango } = await openProject('shop');
    const states = await bango.setContributed([{ origin: 'user-management', metamodel: 'datamodel', text: OFFERED }]);
    expect(states).toMatchObject([{ origin: 'user-management', metamodel: 'datamodel', readOnly: true, available: true }]);
    expect(errors(states[0].problems)).toEqual([]);

    const state = await bango.setText('datamodel', withRelation('UM_User'));
    expect(errors(state.problems)).toEqual([]); // an unresolved reference would be a linking error

    const candidates = await bango.getRefCandidates('Entity');
    expect(candidates.find(c => c.name === 'UM_User')).toMatchObject({ metamodel: 'datamodel', origin: 'user-management' });
    expect(candidates.find(c => c.name === 'Road')?.origin).toBeUndefined();
  });

  it('are not part of the instances or the project JSON, and not editable through the instance API', async () => {
    const { bango } = await openProject('shop');
    const before = await bango.toProjectJson();
    await bango.setContributed([{ origin: 'um', metamodel: 'datamodel', text: OFFERED }]);
    expect((await bango.getInstances()).map(s => s.metamodel)).toEqual(['datamodel']);
    expect((await bango.getInstance('datamodel')).text).not.toContain('UM_User');
    expect(await bango.toProjectJson()).toEqual(before);
  });

  it('leave the reference unresolved when removed', async () => {
    const { bango } = await openProject('shop');
    await bango.setContributed([{ origin: 'um', metamodel: 'datamodel', text: OFFERED }]);
    await bango.setText('datamodel', withRelation('UM_User'));
    expect(errors((await bango.getInstance('datamodel')).problems)).toEqual([]);
    await bango.setContributed([]);
    expect(errors((await bango.getInstance('datamodel')).problems).join('\n')).toMatch(/UM_User/);
  });

  it('report a name offered twice, or offered and also declared by the project', async () => {
    const { bango } = await openProject('shop');
    const second = OFFERED.replace('datamodel um', 'datamodel dup');
    const states = await bango.setContributed([
      { origin: 'a', metamodel: 'datamodel', text: OFFERED },
      { origin: 'b', metamodel: 'datamodel', text: second }
    ]);
    expect(errors(states[0].problems)).toEqual([]);
    expect(errors(states[1].problems).join('\n')).toMatch(/'UM_User' \(Entity\) is already declared by 'a' \(read-only\)/);

    await bango.setContributed([{ origin: 'a', metamodel: 'datamodel', text: OFFERED.replace('UM_User', 'Road') }]);
    const mine = await bango.getInstance('datamodel');
    expect(errors(mine.problems).join('\n')).toMatch(/'Road' \(Entity\) is already declared by 'a' \(read-only\)/);
    const build = await bango.build('shop');
    expect(build.ok).toBe(false);
  });

  it('make the build fail when what they offer is not valid', async () => {
    const { bango } = await openProject('shop');
    expect((await bango.build('shop')).ok).toBe(true);
    await bango.setContributed([{ origin: 'um', metamodel: 'datamodel', text: 'datamodel um\n\nentity Broken {\n  relation x -> Nowhere\n}\n' }]);
    const build = await bango.build('shop');
    expect(build.ok).toBe(false);
    expect(build.errors.join('\n')).toMatch(/um:datamodel/);
  });

  it('refuse to be renamed from the project', async () => {
    const { bango } = await openProject('shop');
    await bango.setContributed([{ origin: 'um', metamodel: 'datamodel', text: OFFERED }]);
    const text = withRelation('UM_User');
    await bango.setText('datamodel', text);
    const line = text.split('\n').findIndex(l => l.includes("relation account"));
    const column = text.split('\n')[line].indexOf('UM_User') + 1;
    const result = await bango.rename('datamodel', text, line, column, 'UM_Person');
    expect(result.error).toMatch(/offered by 'um'.*read-only/);
    expect(result.edits).toEqual([]);
    expect((await bango.getInstance('datamodel')).text).toBe(text);
  });

  it('can come from several origins for one metamodel, and an unknown metamodel is reported, not thrown', async () => {
    const { bango } = await openProject('shop');
    const states = await bango.setContributed([
      { origin: 'um', metamodel: 'datamodel', text: OFFERED },
      { origin: 'other', metamodel: 'datamodel', text: OTHER_OFFERED },
      { origin: 'um', metamodel: 'gismodel', text: 'gismodel x' }
    ]);
    expect(states.map(s => [s.origin, s.available])).toEqual([['um', true], ['other', true], ['um', false]]);
    const names = (await bango.getRefCandidates('Entity')).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['UM_User', 'UM_Group', 'Road']));
  });

  it('are rejected as a whole for a bad origin or a repeated one', async () => {
    const { bango } = await openProject('shop');
    await bango.setContributed([{ origin: 'um', metamodel: 'datamodel', text: OFFERED }]);
    await expect(bango.setContributed([{ origin: 'a/b', metamodel: 'datamodel', text: OFFERED }])).rejects.toThrow(/not a valid origin/);
    await expect(bango.setContributed([
      { origin: 'um', metamodel: 'datamodel', text: OFFERED },
      { origin: 'um', metamodel: 'datamodel', text: OFFERED }
    ])).rejects.toThrow(/two instances/);
    expect((await bango.getContributed()).map(c => c.origin)).toEqual(['um']);
  });
});
