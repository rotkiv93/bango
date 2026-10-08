import { describe, expect, it } from 'vitest';
import { boxLayout, columnLayout } from '../src/index.js';

const box = (id: string, width = 100, height = 60) => ({ id, width, height });

describe('boxLayout', () => {
  it('puts parents above their children, whatever the sizes', () => {
    const p = boxLayout([box('child', 100, 200), box('parent', 100, 80), box('grand', 100, 40)], { hierarchy: [['parent', 'child'], ['child', 'grand']] });
    expect(p.parent.y).toBeLessThan(p.child.y);
    expect(p.child.y).toBeGreaterThanOrEqual(p.parent.y + 80);
    expect(p.grand.y).toBeGreaterThanOrEqual(p.child.y + 200);
  });

  it('puts them before their children when it goes to the right', () => {
    const p = boxLayout([box('a', 120), box('b')], { hierarchy: [['a', 'b']], direction: 'right' });
    expect(p.b.x).toBeGreaterThanOrEqual(p.a.x + 120);
  });

  it('wraps a row at the maximum width and never overlaps two boxes', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => box(`n${i}`, 200, 80));
    const p = boxLayout(nodes, { maxWidth: 700 });
    for (const a of nodes) {
      expect(p[a.id].x + a.width).toBeLessThanOrEqual(700 + 1);
      for (const b of nodes) {
        if (a === b) continue;
        const apart = p[a.id].x + a.width <= p[b.id].x || p[b.id].x + b.width <= p[a.id].x || p[a.id].y + a.height <= p[b.id].y || p[b.id].y + b.height <= p[a.id].y;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
    }
  });

  it('keeps linked nodes next to each other in reading order', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => box(id));
    const p = boxLayout(nodes, { links: [['a', 'f'], ['f', 'c']], maxWidth: 10_000 });
    const order = nodes.map(n => n.id).sort((x, y) => p[x].x - p[y].x);
    expect(Math.abs(order.indexOf('a') - order.indexOf('f'))).toBe(1);
    expect(Math.abs(order.indexOf('f') - order.indexOf('c'))).toBe(1);
  });

  it('survives a cycle, links to nodes that do not exist, and nothing at all', () => {
    expect(Object.keys(boxLayout([box('a'), box('b')], { hierarchy: [['a', 'b'], ['b', 'a'], ['a', 'ghost']] })).sort()).toEqual(['a', 'b']);
    expect(boxLayout([])).toEqual({});
  });

  it('gives the same answer for the same input', () => {
    const nodes = ['a', 'b', 'c'].map(id => box(id));
    expect(boxLayout(nodes, { links: [['a', 'c']] })).toEqual(boxLayout(nodes, { links: [['a', 'c']] }));
  });
});

describe('columnLayout', () => {
  it('stacks each column and puts the columns side by side without overlap', () => {
    const p = columnLayout([[box('a', 100, 50), box('b', 220, 70)], [box('c', 80, 40)]], { gap: 40 });
    expect(p.a).toEqual({ x: 0, y: 0 });
    expect(p.b.x).toBe(0);
    expect(p.b.y).toBeGreaterThanOrEqual(50);
    expect(p.c.x).toBeGreaterThanOrEqual(220);
  });
});
