import type { InstanceAst, InstanceState } from '@bango/core';
import { clear, h, svg } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';
import { edgeElements, edgeGeometry, legend, markerDefs, nodeElement } from './draw.js';
import { buildGraph, type Graph, type GraphNode } from './graph.js';
import { elkLayout, type LayoutFn, type Positions } from './layout.js';
import { Viewport } from './viewport.js';

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
  private camera = new Viewport();
  private edgeLayer = svg('g');
  private nodeLayer = svg('g');
  private positions: Positions = new Map();
  private graph: Graph = { nodes: [], edges: [] };
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
    this.camera.el.append(this.edgeLayer, this.nodeLayer);
    this.svgEl.append(markerDefs(this.prefix), this.camera.el);
    this.root.append(this.svgEl, legend());
    el.appendChild(this.root);
    this.cleanup.push(this.camera.bind(this.svgEl, () => this.fit()));
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

  private fit() {
    this.camera.fit(this.positions, this.svgEl.clientWidth, this.svgEl.clientHeight);
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
      const els = edgeElements(e, this.prefix);
      this.edgeLayer.append(els.path, ...(els.label ? [els.label] : []));
      this.edgeEls.set(e.id, els);
    }
    for (const n of this.graph.nodes) {
      const el = nodeElement(n);
      this.bindNode(el, n);
      this.nodeLayer.appendChild(el);
      this.nodeEls.set(n.id, el);
    }
    this.place();
  }

  /** positions nodes and recomputes every edge */
  private place() {
    for (const n of this.graph.nodes) {
      const p = this.positions.get(n.id) ?? { x: 0, y: 0 };
      this.nodeEls.get(n.id)?.setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    for (const e of this.graph.edges) {
      const a = this.positions.get(e.source);
      const b = this.positions.get(e.target);
      const els = this.edgeEls.get(e.id);
      if (!a || !b || !els) continue;
      const { d, labelX, labelY } = edgeGeometry(a, b);
      els.path.setAttribute('d', d);
      els.label?.setAttribute('x', String(labelX));
      els.label?.setAttribute('y', String(labelY));
    }
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
      const k = this.camera.scale;
      this.positions.set(n.id, { x: drag.px + dx / k, y: drag.py + dy / k });
      this.place();
    });
    g.addEventListener('pointerup', () => {
      // a click, not a drag: show the source
      if (drag && !drag.moved && n.range) this.ctx.reveal(n.metamodel, n.range);
      drag = undefined;
    });
  }
}
