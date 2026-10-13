import { clear, h, svg } from '../dom/dom.js';
import { Viewport } from '../views/diagram/viewport.js';
import { boxLayout } from './box-layout.js';
import type { BoxLayoutOptions, CanvasEdge, CanvasNode, CanvasOptions, EdgeEnd, Point, LayoutPositions } from './types.js';

let counter = 0;

const NEUTRAL = '#8a94a6';
const NODE = '.bango-cnode';
/** the width of a character of an edge label (10px text) */
const LABEL_CHAR = 5.8;

interface Box { x: number; y: number; w: number; h: number }

/** Where the line from the centre of `box` towards `toward` leaves the box. */
function leaves(box: Box, toward: Point): Point {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy));
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * A canvas for diagrams: nodes of any size that can be dragged, edges between them with arrowheads and labels at their ends, pan and zoom,
 * selection, Delete, double-click, and a handle to drag a connection from one node to another. What a node looks like is up to the
 * visualization that draws it; where the nodes are is up to the user, and `onMove` says when they moved.
 */
export class Canvas {
  readonly el: HTMLElement;
  /** where a visualization puts its buttons */
  readonly toolbar: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly camera = new Viewport();
  private readonly defs = svg('defs');
  private readonly edgeLayer = svg('g');
  private readonly nodeLayer = svg('g');
  private readonly overlay = svg('g');
  private readonly prefix = `bango-c${++counter}`;
  private readonly markers = new Set<string>();
  private nodes = new Map<string, CanvasNode & { g: SVGGElement; box: Box }>();
  private edges: CanvasEdge[] = [];
  private edgeEls = new Map<string, { path: SVGPathElement; texts: { el: SVGTextElement; at: 'from' | 'to' | 'mid' }[] }>();
  private pos: LayoutPositions = {};
  private chosen: string | null = null;
  private fitted = false;
  private cleanup: (() => void)[] = [];

  constructor(private options: CanvasOptions = {}) {
    this.svgEl = svg('svg');
    this.camera.el.append(this.edgeLayer, this.nodeLayer, this.overlay);
    this.svgEl.append(this.defs, this.camera.el);
    this.toolbar = h('div', { class: 'bango-ctoolbar' });
    this.el = h('div', { class: 'bango-canvas', tabindex: 0 }, this.svgEl, this.toolbar);
    this.cleanup.push(
      this.camera.bind(this.svgEl, () => this.fit(), NODE, () => { this.select(null); this.el.focus({ preventScroll: true }); })
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.select(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.chosen && !(e.target as Element).closest('input, textarea, select')) {
        e.preventDefault();
        this.options.onDelete?.(this.chosen);
      }
    };
    this.el.addEventListener('keydown', key);
    this.cleanup.push(() => this.el.removeEventListener('keydown', key));
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.el);
  }

  get selected(): string | null { return this.chosen; }

  /** where every node is now */
  positions(): LayoutPositions {
    return Object.fromEntries(Object.entries(this.pos).filter(([id]) => this.nodes.has(id)));
  }

  /**
   * Draw these nodes and edges. `saved` are the positions the user left them at; a node that has none is placed by `layout`, below what is
   * there already. The selection and the view (pan, zoom) stay.
   */
  render(nodes: CanvasNode[], edges: CanvasEdge[], saved: LayoutPositions = {}, layout: BoxLayoutOptions = {}): void {
    clear(this.nodeLayer);
    clear(this.edgeLayer);
    clear(this.overlay);
    this.nodes.clear();
    this.edgeEls.clear();
    this.edges = edges;

    for (const n of nodes) {
      const g = svg('g', { class: 'bango-cnode', 'data-id': n.id });
      g.append(svg('rect', { class: 'bango-selframe', x: -4, y: -4, width: n.width + 8, height: n.height + 8, rx: 6 }), n.el);
      if (n.handle) g.append(this.handleOf(n));
      this.nodeLayer.appendChild(g);
      this.nodes.set(n.id, { ...n, g, box: { x: 0, y: 0, w: n.width, h: n.height } });
      this.bindNode(n.id, g);
    }

    // positions: kept for the nodes that have one (the user's, or where they were drawn a moment ago), laid out for the rest
    const placed: LayoutPositions = {};
    for (const n of nodes) if (saved[n.id] ?? this.pos[n.id]) placed[n.id] = saved[n.id] ?? this.pos[n.id];
    const missing = nodes.filter(n => !placed[n.id]);
    if (missing.length) {
      const links = edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to)).map(e => [e.from, e.to] as [string, string]);
      const fresh = boxLayout(missing, { ...layout, links: [...(layout.links ?? []), ...links] });
      const taken = Object.entries(placed).map(([id, p]) => ({ x: p.x, y: p.y, w: this.nodes.get(id)!.width, h: this.nodes.get(id)!.height }));
      const dy = taken.length ? Math.max(...taken.map(b => b.y + b.h)) + 60 : 0;
      for (const n of missing) placed[n.id] = { x: fresh[n.id].x, y: fresh[n.id].y + dy };
    }
    this.pos = placed;

    for (const e of edges) this.drawEdge(e);
    this.place();
    if (this.chosen && !this.nodes.has(this.chosen)) this.chosen = null;
    this.paintSelection();
    if (!this.fitted && nodes.length) { this.fit(); this.fitted = true; }
    // a node that was just placed is a change the host should keep
    if (missing.length && nodes.length !== missing.length) this.options.onMove?.(this.positions());
  }

  /** Put every node where the layout says, forgetting where they were. */
  autoLayout(layout: BoxLayoutOptions = {}): void {
    const links = this.edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to)).map(e => [e.from, e.to] as [string, string]);
    this.pos = boxLayout([...this.nodes.values()], { ...layout, links: [...(layout.links ?? []), ...links] });
    this.place();
    this.fit();
    this.options.onMove?.(this.positions());
  }

  select(id: string | null): void {
    if (id !== null && !this.nodes.has(id)) id = null;
    if (id === this.chosen) return;
    this.chosen = id;
    this.paintSelection();
    this.options.onSelect?.(id);
  }

  fit(): void {
    const boxes = [...this.nodes.values()].map(n => ({ ...this.pos[n.id], w: n.width, h: n.height })).filter(b => b.x !== undefined);
    this.camera.fitBoxes(boxes, this.svgEl.clientWidth, this.svgEl.clientHeight);
  }

  zoom(factor: number): void {
    this.camera.zoomBy(factor, this.svgEl.clientWidth, this.svgEl.clientHeight);
  }

  dispose(): void {
    this.cleanup.forEach(f => f());
    this.el.remove();
  }

  // ---------------------------------------------------------------- internals

  private paintSelection() {
    for (const [id, n] of this.nodes) n.g.classList.toggle('bango-selected', id === this.chosen);
  }

  private handleOf(n: CanvasNode): SVGElement {
    const handle = svg('circle', { class: 'bango-handle', cx: n.width + 10, cy: n.height / 2, r: 6 }, svg('title', {}, 'Drag onto another node to connect them'));
    let line: SVGLineElement | undefined;
    const to = (e: PointerEvent) => this.camera.toDiagram(this.svgEl, e.clientX, e.clientY);
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      const from = this.pos[n.id] ?? { x: 0, y: 0 };
      line = svg('line', { class: 'bango-rubber', x1: from.x + n.width + 10, y1: from.y + n.height / 2, x2: from.x + n.width + 10, y2: from.y + n.height / 2 });
      this.overlay.appendChild(line);
    });
    handle.addEventListener('pointermove', e => {
      if (!line) return;
      const p = to(e);
      line.setAttribute('x2', String(p.x));
      line.setAttribute('y2', String(p.y));
    });
    handle.addEventListener('pointerup', e => {
      if (!line) return;
      line.remove();
      line = undefined;
      const p = to(e);
      const target = [...this.nodes.values()].find(o => {
        const q = this.pos[o.id];
        return q && p.x >= q.x && p.x <= q.x + o.width && p.y >= q.y && p.y <= q.y + o.height;
      });
      if (target) this.options.onConnect?.(n.id, target.id, { shift: e.shiftKey });
    });
    return handle;
  }

  private bindNode(id: string, g: SVGGElement) {
    let drag: { x: number; y: number; origin: Point; moved: boolean } | undefined;
    g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      this.select(id);
      this.el.focus({ preventScroll: true });
      if (this.nodes.get(id)?.fixed) return;
      drag = { x: e.clientX, y: e.clientY, origin: this.pos[id] ?? { x: 0, y: 0 }, moved: false };
      g.setPointerCapture?.(e.pointerId);
    });
    g.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
      drag.moved = true;
      const k = this.camera.scale;
      this.pos[id] = { x: drag.origin.x + dx / k, y: drag.origin.y + dy / k };
      this.place();
    });
    g.addEventListener('pointerup', () => {
      if (drag?.moved) this.options.onMove?.(this.positions());
      drag = undefined;
    });
    g.addEventListener('dblclick', e => {
      e.stopPropagation();
      this.options.onOpen?.(id);
    });
  }

  private markerId(end: EdgeEnd, color: string): string | undefined {
    if (end === 'none') return undefined;
    const id = `${this.prefix}-${end}-${color.replace(/[^\w]/g, '')}`;
    if (this.markers.has(id)) return id;
    this.markers.add(id);
    const hollow = 'var(--bango-bg, #1e1e1e)';
    const marker = (viewBox: string, w: number, refX: number, shape: SVGElement) =>
      svg('marker', { id, viewBox, refX, refY: 5, markerWidth: w, markerHeight: 10, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, shape);
    if (end === 'arrow') this.defs.appendChild(marker('0 0 10 10', 10, 10, svg('path', { d: 'M1,1 L10,5 L1,9', fill: 'none', stroke: color, 'stroke-width': 1.5 })));
    else if (end === 'triangle') this.defs.appendChild(marker('0 0 12 10', 12, 12, svg('path', { d: 'M1,1 L12,5 L1,9 z', fill: hollow, stroke: color, 'stroke-width': 1.5 })));
    else this.defs.appendChild(marker('0 0 16 10', 16, 16, svg('path', { d: 'M1,5 L8,1 L15,5 L8,9 z', fill: hollow, stroke: color, 'stroke-width': 1.5 })));
    return id;
  }

  private drawEdge(e: CanvasEdge) {
    const color = e.color ?? NEUTRAL;
    const path = svg('path', { class: 'bango-cedge', stroke: color, fill: 'none', 'stroke-width': 1.5, ...(e.dashed ? { 'stroke-dasharray': '5 4' } : {}) });
    const start = this.markerId(e.start ?? 'none', color);
    const end = this.markerId(e.end ?? 'none', color);
    if (start) path.setAttribute('marker-start', `url(#${start})`);
    if (end) path.setAttribute('marker-end', `url(#${end})`);
    const texts: { el: SVGTextElement; at: 'from' | 'to' | 'mid' }[] = [];
    const text = (value: string | undefined, at: 'from' | 'to' | 'mid') => {
      if (!value) return;
      const el = svg('text', { class: 'bango-clabel', fill: color, 'text-anchor': at === 'mid' ? 'middle' : 'start' }, value);
      texts.push({ el, at });
      this.edgeLayer.appendChild(el);
    };
    this.edgeLayer.appendChild(path);
    text(e.fromLabel, 'from');
    text(e.toLabel, 'to');
    text(e.label, 'mid');
    this.edgeEls.set(e.id, { path, texts });
  }

  /** positions the nodes, and routes every edge */
  private place() {
    for (const [id, n] of this.nodes) {
      const p = this.pos[id] ?? { x: 0, y: 0 };
      n.box = { x: p.x, y: p.y, w: n.width, h: n.height };
      n.g.setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    // edges between the same two nodes are drawn side by side
    const between = new Map<string, number>();
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      const els = this.edgeEls.get(e.id);
      if (!a || !b || !els) continue;
      const key = [e.from, e.to].sort().join('\u0000');
      const index = between.get(key) ?? 0;
      between.set(key, index + 1);
      const geometry = this.route(a.box, b.box, a === b, index, e.from > e.to, { from: e.fromLabel?.length ?? 0, to: e.toLabel?.length ?? 0 });
      els.path.setAttribute('d', geometry.d);
      for (const t of els.texts) {
        const at = t.at === 'from' ? geometry.fromLabel : t.at === 'to' ? geometry.toLabel : geometry.midLabel;
        t.el.setAttribute('x', String(at.x));
        t.el.setAttribute('y', String(at.y));
        if (t.at === 'to') t.el.setAttribute('text-anchor', at.anchor);
        if (t.at === 'from') t.el.setAttribute('text-anchor', at.anchor);
      }
    }
  }

  private route(a: Box, b: Box, loop: boolean, index: number, flipped: boolean, lengths: { from: number; to: number }) {
    type Label = Point & { anchor: 'start' | 'end' | 'middle' };
    if (loop) {
      const sx = a.x + a.w - 26, sy = a.y, ex = a.x + a.w, ey = a.y + 26;
      const lift = 36 + index * 14;
      return {
        d: `M${sx},${sy} C${sx},${sy - lift} ${ex + lift},${ey} ${ex},${ey}`,
        fromLabel: { x: sx - 8, y: sy - 6, anchor: 'end' } as Label,
        toLabel: { x: ex + 6, y: ey + 14, anchor: 'start' } as Label,
        midLabel: { x: ex + lift * 0.6, y: sy - lift * 0.6, anchor: 'start' } as Label
      };
    }
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // parallel edges are spread perpendicular to the line between the centres
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const spread = (index % 2 === 0 ? 1 : -1) * Math.ceil(index / 2) * 16 * (flipped ? -1 : 1);
    const nx = (-(cb.y - ca.y) / len) * spread, ny = ((cb.x - ca.x) / len) * spread;
    const p1 = leaves(a, { x: cb.x + nx, y: cb.y + ny }), p2 = leaves(b, { x: ca.x + nx, y: ca.y + ny });
    const q1 = { x: p1.x + nx, y: p1.y + ny }, q2 = { x: p2.x + nx, y: p2.y + ny };
    const ux = (q2.x - q1.x) / (Math.hypot(q2.x - q1.x, q2.y - q1.y) || 1), uy = (q2.y - q1.y) / (Math.hypot(q2.x - q1.x, q2.y - q1.y) || 1);
    // a label sits beside the line, just outside the box it belongs to, and reads away from it (a line that goes left has its text going left)
    const side = (p: Point, along: number, perp: number, anchor: 'start' | 'end'): Label => ({
      x: p.x + ux * along + -uy * perp,
      y: p.y + uy * along + ux * perp,
      anchor
    });
    const rightwards = ux >= 0;
    // each end label goes as close to its box as it can without being under it, and the two do not sit on each other
    const fits = (label: Label, length: number, box: Box) => {
      const w = length * LABEL_CHAR;
      const x0 = label.anchor === 'end' ? label.x - w : label.anchor === 'middle' ? label.x - w / 2 : label.x;
      return !(x0 < box.x + box.w + 3 && x0 + w > box.x - 3 && label.y - 10 < box.y + box.h + 3 && label.y + 3 > box.y - 3);
    };
    const placed = (p: Point, sign: 1 | -1, perp: number, anchor: 'start' | 'end', length: number, box: Box): Label => {
      let label = side(p, sign * 12, perp, anchor);
      for (const along of [12, 26, 40, 54, 68]) {
        label = side(p, sign * along, perp, anchor);
        if (fits(label, length, box)) break;
      }
      return label;
    };
    const fromLabel = placed(q1, 1, -7, rightwards ? 'start' : 'end', lengths.from, a);
    let toLabel = placed(q2, -1, -7, rightwards ? 'end' : 'start', lengths.to, b);
    // on a short line the two would meet: the second goes to the other side of the line
    const span = (l: Label, length: number) => { const w = length * LABEL_CHAR; const x0 = l.anchor === 'end' ? l.x - w : l.anchor === 'middle' ? l.x - w / 2 : l.x; return [x0, x0 + w] as const; };
    const [f0, f1] = span(fromLabel, lengths.from), [t0, t1] = span(toLabel, lengths.to);
    if (lengths.from && lengths.to && f0 < t1 + 4 && t0 < f1 + 4 && Math.abs(fromLabel.y - toLabel.y) < 12) toLabel = placed(q2, -1, 15, rightwards ? 'end' : 'start', lengths.to, b);
    return {
      d: `M${q1.x},${q1.y} L${q2.x},${q2.y}`,
      fromLabel,
      toLabel,
      midLabel: { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 - 6, anchor: 'middle' } as Label
    };
  }
}
