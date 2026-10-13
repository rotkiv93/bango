import type { BoxLayoutOptions, BoxNode, LayoutPositions } from './types.js';

// room for the labels at the ends of the edges that run between two boxes
const DEFAULT_GAP = 90;

/**
 * Places boxes of any size without dependencies. Parents (`hierarchy`) go in rows above their children; the rest are put in reading order so
 * that nodes with a link between them are next to each other, and rows are wrapped at `maxWidth`. A starting point, not a drawing program:
 * people move nodes, and the host keeps where they put them.
 */
export function boxLayout(nodes: BoxNode[], options: BoxLayoutOptions = {}): LayoutPositions {
  const gap = options.gap ?? DEFAULT_GAP;
  const maxWidth = options.maxWidth ?? 1400;
  const down = (options.direction ?? 'down') === 'down';
  const byId = new Map(nodes.map(n => [n.id, n]));
  const known = (pairs: [string, string][] = []) => pairs.filter(([a, b]) => byId.has(a) && byId.has(b) && a !== b);
  const hierarchy = known(options.hierarchy);
  const links = [...hierarchy, ...known(options.links)];

  // the level of a node: how many parents it has above it (a cycle stops where it comes back)
  const parentsOf = new Map<string, string[]>();
  for (const [parent, child] of hierarchy) parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
  const level = new Map<string, number>();
  const levelOf = (id: string, seen: Set<string>): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const l = Math.max(-1, ...(parentsOf.get(id) ?? []).map(p => levelOf(p, seen))) + 1;
    seen.delete(id);
    level.set(id, l);
    return l;
  };
  for (const n of nodes) levelOf(n.id, new Set());

  // reading order: walk the links from the best connected nodes, so neighbours end up next to each other
  const neighbours = new Map<string, string[]>();
  for (const [a, b] of links) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const degree = (id: string) => neighbours.get(id)?.length ?? 0;
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    for (const next of [...(neighbours.get(id) ?? [])].sort((a, b) => degree(b) - degree(a))) visit(next);
  };
  // start a chain from its end: from the middle, one of its sides would end up away from it
  const starting = (id: string) => (degree(id) === 0 ? Infinity : degree(id));
  for (const n of [...nodes].sort((a, b) => starting(a.id) - starting(b.id))) visit(n.id);

  const levels = new Map<number, string[]>();
  for (const id of order) levels.set(level.get(id) ?? 0, [...(levels.get(level.get(id) ?? 0) ?? []), id]);

  // each level is a band (a row of boxes, wrapped at maxWidth when going down; a column, wrapped at maxWidth tall when going right)
  const positions: LayoutPositions = {};
  let offset = 0;
  for (const l of [...levels.keys()].sort((a, b) => a - b)) {
    const ids = levels.get(l)!;
    let along = 0, bandThickness = 0, lineThickness = 0;
    let lineStart = offset;
    for (const id of ids) {
      const n = byId.get(id)!;
      const length = down ? n.width : n.height;
      const thick = down ? n.height : n.width;
      if (along > 0 && along + length > maxWidth) {
        // wrap
        lineStart += lineThickness + gap;
        bandThickness += lineThickness + gap;
        along = 0;
        lineThickness = 0;
      }
      positions[id] = down ? { x: along, y: lineStart } : { x: lineStart, y: along };
      along += length + gap;
      lineThickness = Math.max(lineThickness, thick);
    }
    bandThickness += lineThickness;
    offset += bandThickness + gap * 1.5;
  }
  return positions;
}

/** The nodes of each column under one another, the columns side by side, each column as wide as its widest node. */
export function columnLayout(columns: BoxNode[][], options: { gap?: number } = {}): LayoutPositions {
  const gap = options.gap ?? DEFAULT_GAP;
  const positions: LayoutPositions = {};
  let x = 0;
  for (const column of columns) {
    let y = 0;
    for (const n of column) {
      positions[n.id] = { x, y };
      y += n.height + gap / 2;
    }
    x += Math.max(0, ...column.map(n => n.width)) + gap * 1.5;
  }
  return positions;
}
