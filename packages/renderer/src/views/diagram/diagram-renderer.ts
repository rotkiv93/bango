import type { InstanceAst, InstanceState } from '@bango/engine';
import { clear, h, svg } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';
import { buildGraph, type Graph, type GraphEdge, type GraphNode } from './graph.js';
import { NODE_H, NODE_W, elkLayout, type LayoutFn, type Positions } from './layout.js';

const PALETTE = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6'];
const colorOf = (metamodel: string) => PALETTE[[...metamodel].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
const EDGE = { contains: '#888888', ref: '#60a5fa', cross: '#f59e0b' } as const;
const edgeColor = (e: GraphEdge) => (e.kind === 'contains' ? EDGE.contains : e.cross ? EDGE.cross : EDGE.ref);

let counter = 0;

export interface DiagramOptions {
  /** how to place the nodes; defaults to elkjs when available, a built-in layered layout otherwise */
  layout?: LayoutFn;
}

/**
 * Diagram of the whole project: every instance of every metamodel as nodes (named elements), linked by
 * containment and by references, including references across metamodels. Pan with the mouse, zoom with
 * the wheel, drag nodes, double-click the background to fit, click a node to show its source.
 */
export class DiagramRenderer implements InstanceRenderer {
  private root!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private viewport!: SVGGElement;
  private edgeLayer!: SVGGElement;
  private nodeLayer!: SVGGElement;
  private positions: Positions = new Map();
  private graph: Graph = { nodes: [], edges: [] };
  private view = { x: 0, y: 0, k: 1 };
  private fitted = false;
  private seq = 0;
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls = new Map<string, { path: SVGPathElement; label?: SVGTextElement }>();
  private readonly prefix = `bango-d${++counter}`;
  private cleanup: (() => void)[] = [];

  constructor(private ctx: RenderContext, private options: DiagramOptions = {}) {}

  mount(el: HTMLElement) {
    this.root = h('div', { class: 'bango-diagram' });
    this.svgEl = svg('svg');
    this.viewport = svg('g');
    this.edgeLayer = svg('g');
    this.nodeLayer = svg('g');
    this.viewport.append(this.edgeLayer, this.nodeLayer);
    this.svgEl.append(this.defs(), this.viewport);
    this.root.append(
      this.svgEl,
      h('div', { class: 'bango-legend' },
        h('span', { style: `color:${EDGE.contains}` }, '— contains'),
        h('span', { style: `color:${EDGE.ref}` }, '- - references'),
        h('span', { style: `color:${EDGE.cross}` }, '- - references across metamodels'))
    );
    el.appendChild(this.root);
    this.bindInteractions();
  }

  async update(_state: InstanceState) {
    const seq = ++this.seq;
    const instances: InstanceAst[] = (await this.ctx.engine.getInstances()).filter(i => i.ast).map(i => ({ metamodel: i.metamodel, ast: i.ast! }));
    const graph = buildGraph(instances);
    const positions = graph.nodes.length ? await (this.options.layout ?? elkLayout)(graph) : new Map();
    if (seq !== this.seq) return;
    this.graph = graph;
    this.positions = positions;
    this.render();
    if (!this.fitted && graph.nodes.length) { this.fit(); this.fitted = true; }
  }

  dispose() {
    this.seq++;
    this.cleanup.forEach(f => f());
    this.root?.remove();
  }

  /** number of nodes and edges currently drawn (handy for tests and status lines) */
  get stats() {
    return { nodes: this.graph.nodes.length, edges: this.graph.edges.length };
  }

  // ----------------------------------------------------------------- drawing

  private defs() {
    const defs = svg('defs');
    for (const [name, color] of Object.entries(EDGE)) {
      defs.appendChild(svg('marker', { id: `${this.prefix}-${name}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
        svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })));
    }
    return defs;
  }

  private render() {
    clear(this.edgeLayer);
    clear(this.nodeLayer);
    this.nodeEls.clear();
    this.edgeEls.clear();
    if (!this.graph.nodes.length) {
      this.nodeLayer.appendChild(svg('text', { x: 16, y: 28, fill: 'currentColor', opacity: 0.7 }, 'No named elements to draw yet.'));
    }
    for (const e of this.graph.edges) {
      const color = edgeColor(e);
      const marker = e.kind === 'contains' ? 'contains' : e.cross ? 'cross' : 'ref';
      const path = svg('path', {
        class: `bango-dedge${e.kind === 'ref' ? ' bango-ref' : ''}`, stroke: color, 'marker-end': `url(#${this.prefix}-${marker})`,
        ...(e.cross ? { 'stroke-width': 2 } : {})
      });
      const label = e.label ? svg('text', { 'font-size': 10, fill: color, 'text-anchor': 'middle' }, e.label) : undefined;
      this.edgeLayer.append(path, ...(label ? [label] : []));
      this.edgeEls.set(e.id, { path, label });
    }
    for (const n of this.graph.nodes) {
      const el = this.nodeElement(n);
      this.nodeLayer.appendChild(el);
      this.nodeEls.set(n.id, el);
    }
    this.place();
  }

  private nodeElement(n: GraphNode): SVGGElement {
    const color = colorOf(n.metamodel);
    const g = svg('g', { class: 'bango-dnode' },
      svg('title', {}, `${n.metamodel}: ${n.type} ${n.name}`),
      svg('rect', { width: NODE_W, height: NODE_H, rx: 6, fill: color, 'fill-opacity': 0.14, stroke: color, 'stroke-width': 1.5 }),
      svg('text', { x: 10, y: 20, opacity: 0.75 }, n.type),
      svg('text', { x: 10, y: 37, 'font-weight': 600 }, n.name)
    );
    this.bindNode(g, n);
    return g;
  }

  /** positions nodes and recomputes every edge */
  private place() {
    for (const n of this.graph.nodes) {
      const p = this.positions.get(n.id) ?? { x: 0, y: 0 };
      this.nodeEls.get(n.id)?.setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    for (const e of this.graph.edges) this.placeEdge(e);
    this.viewport.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
  }

  private placeEdge(e: GraphEdge) {
    const a = this.positions.get(e.source);
    const b = this.positions.get(e.target);
    const els = this.edgeEls.get(e.id);
    if (!a || !b || !els) return;
    // anchor on the facing sides of the two boxes
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
    els.path.setAttribute('d', d);
    els.label?.setAttribute('x', String((x1 + x2) / 2));
    els.label?.setAttribute('y', String((y1 + y2) / 2 - 4));
  }

  private fit() {
    const ps = [...this.positions.values()];
    if (!ps.length) return;
    const minX = Math.min(...ps.map(p => p.x)), maxX = Math.max(...ps.map(p => p.x)) + NODE_W;
    const minY = Math.min(...ps.map(p => p.y)), maxY = Math.max(...ps.map(p => p.y)) + NODE_H;
    const w = this.svgEl.clientWidth || 800, hgt = this.svgEl.clientHeight || 600;
    const k = Math.min(w / (maxX - minX + 60), hgt / (maxY - minY + 60), 1.5);
    this.view = { k, x: (w - (maxX - minX) * k) / 2 - minX * k, y: (hgt - (maxY - minY) * k) / 2 - minY * k };
    this.viewport.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
  }

  // ------------------------------------------------------------ interaction

  private bindInteractions() {
    const svgEl = this.svgEl;
    let pan: { x: number; y: number; vx: number; vy: number } | undefined;

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('.bango-dnode')) return;
      pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      svgEl.classList.add('bango-panning');
      svgEl.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!pan) return;
      this.view.x = pan.vx + e.clientX - pan.x;
      this.view.y = pan.vy + e.clientY - pan.y;
      this.viewport.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
    };
    const up = () => { pan = undefined; svgEl.classList.remove('bango-panning'); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const k = Math.min(4, Math.max(0.1, this.view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      // keep the point under the cursor fixed while zooming
      this.view = { k, x: px - ((px - this.view.x) / this.view.k) * k, y: py - ((py - this.view.y) / this.view.k) * k };
      this.viewport.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
    };
    const dbl = (e: MouseEvent) => { if (!(e.target as Element).closest('.bango-dnode')) this.fit(); };

    svgEl.addEventListener('pointerdown', down);
    svgEl.addEventListener('pointermove', move);
    svgEl.addEventListener('pointerup', up);
    svgEl.addEventListener('wheel', wheel, { passive: false });
    svgEl.addEventListener('dblclick', dbl);
    this.cleanup.push(() => {
      svgEl.removeEventListener('pointerdown', down);
      svgEl.removeEventListener('pointermove', move);
      svgEl.removeEventListener('pointerup', up);
      svgEl.removeEventListener('wheel', wheel);
      svgEl.removeEventListener('dblclick', dbl);
    });
  }

  private bindNode(g: SVGGElement, n: GraphNode) {
    let drag: { x: number; y: number; px: number; py: number; moved: boolean } | undefined;
    g.addEventListener('pointerdown', e => {
      const p = this.positions.get(n.id) ?? { x: 0, y: 0 };
      drag = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, moved: false };
      g.setPointerCapture?.(e.pointerId);
      e.stopPropagation();
    });
    g.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      this.positions.set(n.id, { x: drag.px + dx / this.view.k, y: drag.py + dy / this.view.k });
      this.place();
    });
    g.addEventListener('pointerup', () => {
      // a click, not a drag: show the source
      if (drag && !drag.moved && n.range) this.ctx.reveal(n.metamodel, n.range);
      drag = undefined;
    });
  }
}
