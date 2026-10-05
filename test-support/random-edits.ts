import type { BangoApi, EditOp, FieldSchema, FormSchema, InstanceState } from '@bango/core';
import { sitesOf } from './edits.js';

/** A small deterministic generator: a failure names its seed, and the same seed gives the same run on any machine. */
export function random(seed: number) {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(items: T[]) => items[Math.floor(next() * items.length)] };
}

export type Random = ReturnType<typeof random>;

/** One random edit of an instance, built from what its form schema says it may contain. undefined when this draw found nothing to do. */
export async function randomOp(bango: BangoApi, state: InstanceState, schema: FormSchema, rng: Random, counter: { n: number }): Promise<EditOp | undefined> {
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

async function valueFor(bango: BangoApi, field: FieldSchema, rng: Random, counter: { n: number }): Promise<string | number | boolean> {
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
