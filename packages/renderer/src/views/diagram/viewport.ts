import { svg } from '../../dom/dom.js';
import { NODE_H, NODE_W, type Point, type Positions } from './layout.js';

/** A rectangle in the diagram's own coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The camera of a diagram: an SVG group that is panned and zoomed. */
export class Viewport {
  readonly el = svg('g');
  private view = { x: 0, y: 0, k: 1 };

  get scale() { return this.view.k; }

  private apply() {
    this.el.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
  }

  /** Centre and scale to show every node. */
  fit(positions: Positions, width: number, height: number) {
    this.fitBoxes([...positions.values()].map(p => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H })), width, height);
  }

  /** Centre and scale to show every box (nodes of any size). */
  fitBoxes(boxes: Box[], width: number, height: number) {
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map(b => b.x)), maxX = Math.max(...boxes.map(b => b.x + b.w));
    const minY = Math.min(...boxes.map(b => b.y)), maxY = Math.max(...boxes.map(b => b.y + b.h));
    const w = width || 800, h = height || 600;
    const k = Math.min(w / (maxX - minX + 60), h / (maxY - minY + 60), 1.5);
    this.view = { k, x: (w - (maxX - minX) * k) / 2 - minX * k, y: (h - (maxY - minY) * k) / 2 - minY * k };
    this.apply();
  }

  /** Zoom around the centre of the view by a factor (1.2 zooms in). */
  zoomBy(factor: number, width: number, height: number) {
    const px = (width || 800) / 2, py = (height || 600) / 2;
    const k = Math.min(4, Math.max(0.1, this.view.k * factor));
    this.view = { k, x: px - ((px - this.view.x) / this.view.k) * k, y: py - ((py - this.view.y) / this.view.k) * k };
    this.apply();
  }

  /** The point of the diagram that is under a point of the screen. */
  toDiagram(svgEl: SVGSVGElement, clientX: number, clientY: number): Point {
    const rect = svgEl.getBoundingClientRect();
    return { x: (clientX - rect.left - this.view.x) / this.view.k, y: (clientY - rect.top - this.view.y) / this.view.k };
  }

  /**
   * Drag the background to pan, wheel to zoom around the cursor, double-click the background to `onFit`. Returns what undoes it.
   * `nodeSelector` is what the pointer is on when it is on a node, which the nodes handle themselves.
   */
  bind(svgEl: SVGSVGElement, onFit: () => void, nodeSelector = '.bango-dnode', onBackground?: () => void): () => void {
    let pan: { x: number; y: number; vx: number; vy: number } | undefined;

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest(nodeSelector)) return;
      onBackground?.();
      pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      svgEl.classList.add('bango-panning');
      svgEl.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!pan) return;
      this.view.x = pan.vx + e.clientX - pan.x;
      this.view.y = pan.vy + e.clientY - pan.y;
      this.apply();
    };
    const up = () => { pan = undefined; svgEl.classList.remove('bango-panning'); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const k = Math.min(4, Math.max(0.1, this.view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      // keep the point under the cursor fixed while zooming
      this.view = { k, x: px - ((px - this.view.x) / this.view.k) * k, y: py - ((py - this.view.y) / this.view.k) * k };
      this.apply();
    };
    const dbl = (e: MouseEvent) => { if (!(e.target as Element).closest(nodeSelector)) onFit(); };

    svgEl.addEventListener('pointerdown', down);
    svgEl.addEventListener('pointermove', move);
    svgEl.addEventListener('pointerup', up);
    svgEl.addEventListener('wheel', wheel, { passive: false });
    svgEl.addEventListener('dblclick', dbl);
    return () => {
      svgEl.removeEventListener('pointerdown', down);
      svgEl.removeEventListener('pointermove', move);
      svgEl.removeEventListener('pointerup', up);
      svgEl.removeEventListener('wheel', wheel);
      svgEl.removeEventListener('dblclick', dbl);
    };
  }
}
