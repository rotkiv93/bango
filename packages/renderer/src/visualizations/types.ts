import type { ContributedState, EngineApi, InstanceState, PathStep } from '@bango/core';
import type { InstanceRenderer, RenderContext } from '../host/types.js';

export interface Point {
  x: number;
  y: number;
}

/** Where the nodes of a view are, by a key the view chooses (the name of what the node shows, usually). */
export type LayoutPositions = Record<string, Point>;

/**
 * Where a host keeps the positions of the nodes the views of a metamodel draw. bango never saves anything: the host does, next to the model
 * (a file in the product's repository, a key in the browser's storage, ...), and gives the positions back when the view is opened again.
 */
export interface LayoutStore {
  get(metamodel: string, view: string): LayoutPositions;
  set(metamodel: string, view: string, positions: LayoutPositions): void;
}

/** What a view is given to read and write its own positions. */
export interface LayoutHandle {
  get(): LayoutPositions;
  set(positions: LayoutPositions): void;
}

/**
 * What a visualization is given each time it draws: the instance of its metamodel, and the read-only instances other parties offer
 * (what a module adds to the data model, say) with their trees. They are for every metamodel: a sensor diagram may want the entities
 * a module offers to the data model. Only the ones that could be read (`available`) are here.
 */
export interface VisualizationState extends InstanceState {
  offered: ContributedState[];
}

/** An `InstanceRenderer` that draws offered instances too. */
interface VisualizationRenderer extends Omit<InstanceRenderer, 'update'> {
  update(state: VisualizationState): void | Promise<void>;
}

export interface VisualizationContext extends RenderContext {
  layout: LayoutHandle;
  /** Show the node at `path` in the inspector (a form for that node alone), or close it with `null`. */
  inspect(path: PathStep[] | null): void;
}

/**
 * One way of showing the instances of a metamodel, written by the metamodel itself (in `<name>.visualizations.js`): a class diagram for a data
 * model, a sensor diagram for sensors. bango runs it, and knows nothing of what it draws.
 */
export interface Visualization {
  /** unique within the metamodel; the view is called `viz:<id>` */
  id: string;
  label: string;
  description?: string;
  create(ctx: VisualizationContext, kit: VisualizationKit): VisualizationRenderer;
}

/** What one view of a metamodel can be: a built-in one, or one the metamodel brings. */
export interface ViewInfo {
  id: string;
  label: string;
  kind: 'builtin' | 'visualization';
  description?: string;
  /** the visualizations of the metamodel could not be loaded: why (the view shows it) */
  error?: string;
}

export type EditorFailure = (message: string) => void;

/** Edits the instance of a metamodel by its tree, one change at a time. A change the grammar refuses is reported, not thrown. */
export interface Editor {
  /** add a node (`type`, or the first the feature allows) to a list or an optional child; returns the path of the new node */
  add(path: PathStep[], feature: string, type?: string): Promise<PathStep[] | undefined>;
  /** add a node and give it a name straight away (what a user sees: a new entity called `Customer`) */
  addNamed(path: PathStep[], feature: string, type: string | undefined, name: string): Promise<PathStep[] | undefined>;
  /** add an item to a list of values or references (`values`, `sensors`) */
  addValue(path: PathStep[], feature: string, value: string): Promise<boolean>;
  set(path: PathStep[], feature: string, value: string | number | boolean | null, index?: number): Promise<boolean>;
  /** remove a node (the path points at it), or one item of a list when `feature` and `index` are given */
  remove(path: PathStep[], feature?: string, index?: number): Promise<boolean>;
}

export type EdgeEnd = 'none' | 'arrow' | 'triangle' | 'diamond';

export interface CanvasNode {
  id: string;
  /** what the node looks like, drawn with `svg()` from (0, 0) to (width, height) */
  el: SVGElement;
  width: number;
  height: number;
  /** show a small handle to drag a connection from (see `onConnect`) */
  handle?: boolean;
  /** cannot be moved */
  fixed?: boolean;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  color?: string;
  dashed?: boolean;
  /** the end at `from` and at `to` */
  start?: EdgeEnd;
  end?: EdgeEnd;
  /** text near each end, and in the middle */
  fromLabel?: string;
  toLabel?: string;
  label?: string;
}

export interface CanvasOptions {
  onSelect?(id: string | null): void;
  /** double-click on a node */
  onOpen?(id: string): void;
  /** Delete or Backspace with a node selected */
  onDelete?(id: string): void;
  /** a connection was dragged from the handle of one node to another (`shift` was held) */
  onConnect?(from: string, to: string, modifiers: { shift: boolean }): void;
  /** a node was moved (called when the move ends) */
  onMove?(positions: LayoutPositions): void;
}

export interface BoxNode {
  id: string;
  width: number;
  height: number;
}

export interface BoxLayoutOptions {
  /** `parent -> child` pairs: parents go above (`down`) or before (`right`) their children */
  hierarchy?: [string, string][];
  /** other links; linked nodes are kept close */
  links?: [string, string][];
  direction?: 'down' | 'right';
  gap?: number;
  /** a row is wrapped at this width (default 1400) */
  maxWidth?: number;
}

/** The part of `@bango/renderer` that a visualization draws with. The metamodel's file is given it as `kit`. */
export interface VisualizationKit {
  h: typeof import('../dom/dom.js').h;
  svg: typeof import('../dom/dom.js').svg;
  clear: typeof import('../dom/dom.js').clear;
  asArray: typeof import('../dom/dom.js').asArray;
  /** a pannable, zoomable canvas of draggable nodes joined by edges */
  Canvas: new (options?: CanvasOptions) => import('./canvas.js').Canvas;
  boxLayout(nodes: BoxNode[], options?: BoxLayoutOptions): LayoutPositions;
  /** put the nodes of each column under one another, the columns side by side */
  columnLayout(columns: BoxNode[][], options?: { gap?: number }): LayoutPositions;
  /** the text of every node a metamodel gives a name, with its path in the instance */
  walk(ast: import('@bango/core').AstDto, visit: (node: import('@bango/core').AstDto, path: PathStep[]) => void): void;
  nodeAt(ast: import('@bango/core').AstDto, path: PathStep[]): import('@bango/core').AstDto | undefined;
  editor(engine: EngineApi, metamodel: string, onFailure?: EditorFailure): Editor;
  /** a short text that fits in `width` pixels at 11px, cut with an ellipsis */
  fit(text: string, width: number): string;
}
