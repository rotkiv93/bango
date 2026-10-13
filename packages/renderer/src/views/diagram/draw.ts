import { h, svg } from '../../dom/dom.js';
import type { GraphEdge, GraphNode } from './graph.js';
import { NODE_H, NODE_W, type Point } from './layout.js';

const PALETTE = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6'];
const colorOf = (metamodel: string) => PALETTE[[...metamodel].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

const EDGE = { contains: '#888888', ref: '#60a5fa', cross: '#f59e0b' } as const;

/** Which of the three edge styles an edge is drawn in. */
const edgeKind = (e: GraphEdge): keyof typeof EDGE => (e.kind === 'contains' ? 'contains' : e.cross ? 'cross' : 'ref');

/** The arrowheads, one per edge style; `prefix` keeps the ids unique when several diagrams share a page. */
export function markerDefs(prefix: string): SVGDefsElement {
  const defs = svg('defs');
  for (const [name, color] of Object.entries(EDGE)) {
    defs.appendChild(svg('marker', { id: `${prefix}-${name}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })));
  }
  return defs;
}

export function legend(): HTMLElement {
  return h('div', { class: 'bango-legend' },
    h('span', { style: `color:${EDGE.contains}` }, '— contains'),
    h('span', { style: `color:${EDGE.ref}` }, '- - references'),
    h('span', { style: `color:${EDGE.cross}` }, '- - references across metamodels'));
}

export function nodeElement(n: GraphNode): SVGGElement {
  const color = colorOf(n.metamodel);
  return svg('g', { class: 'bango-dnode' },
    svg('title', {}, `${n.metamodel}: ${n.type} ${n.name}`),
    svg('rect', { width: NODE_W, height: NODE_H, rx: 6, fill: color, 'fill-opacity': 0.14, stroke: color, 'stroke-width': 1.5 }),
    svg('text', { x: 10, y: 20, opacity: 0.75 }, n.type),
    svg('text', { x: 10, y: 37, 'font-weight': 600 }, n.name)
  );
}

export function edgeElements(e: GraphEdge, prefix: string): { path: SVGPathElement; label?: SVGTextElement } {
  const kind = edgeKind(e);
  const color = EDGE[kind];
  const path = svg('path', {
    class: `bango-dedge${e.kind === 'ref' ? ' bango-ref' : ''}`, stroke: color, 'marker-end': `url(#${prefix}-${kind})`,
    ...(e.cross ? { 'stroke-width': 2 } : {})
  });
  const label = e.label ? svg('text', { 'font-size': 10, fill: color, 'text-anchor': 'middle' }, e.label) : undefined;
  return { path, label };
}

/** The curve between two boxes, anchored on their facing sides, and where its label goes. */
export function edgeGeometry(a: Point, b: Point): { d: string; labelX: number; labelY: number } {
  let x1: number, y1: number, x2: number, y2: number, d: string;
  if (b.x > a.x + NODE_W) {
    [x1, y1, x2, y2] = [a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2];
    const dx = Math.max(30, (x2 - x1) / 2);
    d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  } else if (b.x + NODE_W < a.x) {
    [x1, y1, x2, y2] = [a.x, a.y + NODE_H / 2, b.x + NODE_W, b.y + NODE_H / 2];
    const dx = Math.max(30, (x1 - x2) / 2);
    d = `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
  } else {
    const down = b.y > a.y;
    [x1, y1, x2, y2] = [a.x + NODE_W / 2, a.y + (down ? NODE_H : 0), b.x + NODE_W / 2, b.y + (down ? 0 : NODE_H)];
    const dy = Math.max(30, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
    d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
  return { d, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - 4 };
}
