import type { AstDto, InstanceAst, Range0 } from '@bango/core';
import { asArray } from '../../dom/dom.js';

export interface GraphNode {
  id: string;
  metamodel: string;
  type: string;
  name: string;
  range?: Range0;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'contains' | 'ref';
  /** the feature that holds the reference */
  label?: string;
  /** a reference from one metamodel's instance into another's */
  cross: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Named AST nodes become nodes; containment and cross-references become edges (across instances and metamodels). */
export function buildGraph(instances: InstanceAst[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byKey = new Map<string, GraphNode>();
  const pending: { from: GraphNode; feature: string; key: string }[] = [];

  const walk = (metamodel: string, node: AstDto, path: string, parent?: GraphNode) => {
    let self = parent;
    if (node.name) {
      self = { id: `${metamodel}#${path}`, metamodel, type: node.type, name: node.name, range: node.range };
      nodes.push(self);
      byKey.set(`${metamodel}|${node.type}|${node.name}`, self);
      if (parent) edges.push({ id: `c:${parent.id}>${self.id}`, source: parent.id, target: self.id, kind: 'contains', cross: false });
    }
    if (self) {
      for (const [feature, r] of Object.entries(node.refs)) {
        for (const ref of asArray(r)) {
          if (ref.resolved) pending.push({ from: self, feature, key: `${ref.targetMetamodel}|${ref.targetType}|${ref.targetName}` });
        }
      }
    }
    for (const [feature, c] of Object.entries(node.children)) {
      asArray(c).forEach((child, i) => walk(metamodel, child, `${path}/${feature}${i}`, self));
    }
  };
  instances.forEach(i => walk(i.metamodel, i.ast, ''));

  pending.forEach((r, i) => {
    const target = byKey.get(r.key);
    if (!target || target.id === r.from.id) return;
    edges.push({ id: `r${i}`, source: r.from.id, target: target.id, kind: 'ref', label: r.feature, cross: r.from.metamodel !== target.metamodel });
  });
  return { nodes, edges };
}
