import { svg } from '../../dom/dom.js';
import { NODE_H, NODE_W, type Positions } from './layout.js';

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
    const ps = [...positions.values()];
    if (!ps.length) return;
    const minX = Math.min(...ps.map(p => p.x)), maxX = Math.max(...ps.map(p => p.x)) + NODE_W;
    const minY = Math.min(...ps.map(p => p.y)), maxY = Math.max(...ps.map(p => p.y)) + NODE_H;
    const w = width || 800, h = height || 600;
    const k = Math.min(w / (maxX - minX + 60), h / (maxY - minY + 60), 1.5);
    this.view = { k, x: (w - (maxX - minX) * k) / 2 - minX * k, y: (h - (maxY - minY) * k) / 2 - minY * k };
    this.apply();
  }

  /** Drag the background to pan, wheel to zoom around the cursor, double-click the background to `onFit`. Returns what undoes it. */
  bind(svgEl: SVGSVGElement, onFit: () => void): () => void {
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
    const dbl = (e: MouseEvent) => { if (!(e.target as Element).closest('.bango-dnode')) onFit(); };

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
