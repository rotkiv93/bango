import type { Graph } from './graph.js';

export const NODE_W = 170;
export const NODE_H = 48;

export type Point = { x: number; y: number };
export type Positions = Map<string, Point>;
export type LayoutFn = (graph: Graph) => Promise<Positions>;

/**
 * Plain layered layout without dependencies: containment depth decides the column, order of appearance the row.
 * Used when elkjs is not available.
 */
export const layeredLayout: LayoutFn = async graph => {
  const parents = new Map<string, string>();
  for (const e of graph.edges) if (e.kind === 'contains') parents.set(e.target, e.source);
  const depth = (id: string): number => {
    let d = 0;
    for (let cur = parents.get(id); cur !== undefined && d < 1000; cur = parents.get(cur)) d++;
    return d;
  };
  const rows = new Map<number, number>();
  const positions: Positions = new Map();
  for (const n of graph.nodes) {
    const col = depth(n.id);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    positions.set(n.id, { x: col * (NODE_W + 70), y: row * (NODE_H + 26) });
  }
  return positions;
};

/** Layered layout by elkjs (an optional peer dependency). Falls back to `layeredLayout` when it cannot be loaded. */
export const elkLayout: LayoutFn = async graph => {
  let ELK: new () => { layout(g: unknown): Promise<{ children?: { id: string; x?: number; y?: number }[] }> };
  try {
    ELK = (await import('elkjs/lib/elk.bundled.js')).default as unknown as typeof ELK;
  } catch {
    return layeredLayout(graph);
  }
  const result = await new ELK().layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '24', 'elk.layered.spacing.nodeNodeBetweenLayers': '60' },
    children: graph.nodes.map(n => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: graph.edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  });
  return new Map((result.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
};
