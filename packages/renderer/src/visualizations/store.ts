import { asArray, clear, h, svg } from '../dom/dom.js';
import { boxLayout, columnLayout } from './box-layout.js';
import { Canvas } from './canvas.js';
import { editor, fitText, nodeAt, walk } from './edits.js';
import type { LayoutPositions, LayoutStore, ViewInfo, Visualization, VisualizationKit } from './types.js';

type Listener = () => void;

/**
 * The visualizations the metamodels bring (the text of their `<name>.visualizations.js`), by metamodel name. The host fills it from the
 * packages it loaded and gives it to the `ModelRenderer`, which offers them as views. Each host has its own: what one page shows of a
 * metamodel is not what another page loaded.
 */
export class VisualizationStore {
  private readonly sources = new Map<string, string>();
  private readonly listeners = new Set<Listener>();

  /** Set the text of a metamodel's visualizations; empty or `undefined` takes them away. */
  set(metamodel: string, code: string | undefined): void {
    const text = code?.trim() ? code : undefined;
    if (this.sources.get(metamodel) === text) return;
    if (text === undefined) this.sources.delete(metamodel);
    else this.sources.set(metamodel, text);
    for (const l of [...this.listeners]) l();
  }

  get(metamodel: string): string | undefined {
    return this.sources.get(metamodel);
  }

  /** Replace every metamodel's visualizations at once (`{ datamodel: '...' }`). */
  load(all: Record<string, string | undefined>): void {
    let changed = false;
    for (const metamodel of [...this.sources.keys()]) {
      if (!all[metamodel]?.trim()) { this.sources.delete(metamodel); changed = true; }
    }
    for (const [metamodel, code] of Object.entries(all)) {
      if (code?.trim() && this.sources.get(metamodel) !== code) { this.sources.set(metamodel, code); changed = true; }
    }
    if (changed) for (const l of [...this.listeners]) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** LayoutPositions kept in memory, by metamodel and view. The host reads `toJSON()` to save them and calls `load()` to give them back. */
export class MemoryLayoutStore implements LayoutStore {
  private data: Record<string, Record<string, LayoutPositions>> = {};
  private readonly listeners = new Set<Listener>();

  get(metamodel: string, view: string): LayoutPositions {
    return this.data[metamodel]?.[view] ?? {};
  }

  set(metamodel: string, view: string, positions: LayoutPositions): void {
    this.data[metamodel] = { ...this.data[metamodel], [view]: positions };
    for (const l of [...this.listeners]) l();
  }

  /** everything, as plain data to save */
  toJSON(): Record<string, Record<string, LayoutPositions>> {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** replace everything with what `toJSON()` once gave (does not notify: it is what the host already has) */
  load(data: Record<string, Record<string, LayoutPositions>>): void {
    this.data = JSON.parse(JSON.stringify(data ?? {}));
  }

  /** called each time a view moves a node */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** What a metamodel's visualizations are given to draw with (and may use as a plain variable `kit`). */
export const kit: VisualizationKit = {
  h,
  svg,
  clear,
  asArray,
  Canvas: Canvas as VisualizationKit['Canvas'],
  boxLayout,
  columnLayout,
  walk,
  nodeAt,
  editor,
  fit: fitText
};

const compiled = new Map<string, Visualization[] | Error>();

/**
 * Compile the text of a metamodel's `<name>.visualizations.js`: the body of a function that returns the list of its visualizations.
 *
 *   return [{ id: 'class-diagram', label: 'Class diagram', create(ctx, kit) { return { mount, update, dispose }; } }];
 *
 * The code runs in the page, with everything the page has: bango does not sandbox it. It is as trusted as the package that holds it.
 * Throws a readable error when it does not compile, does not return what it should, or repeats an id.
 */
export function loadVisualizations(code: string): Visualization[] {
  const cached = compiled.get(code);
  if (cached instanceof Error) throw cached;
  if (cached) return cached;
  try {
    const result = new Function('kit', `return (function () { "use strict";\n${code}\n}).call(undefined);`)(kit) as unknown;
    if (!Array.isArray(result)) throw new Error('it must return an array of { id, label, create }');
    const seen = new Set<string>();
    for (const v of result as Partial<Visualization>[]) {
      if (typeof v?.id !== 'string' || !/^[\w-]+$/.test(v.id)) throw new Error(`a visualization needs an id of letters, digits, - and _ (got ${JSON.stringify(v?.id)})`);
      if (typeof v.label !== 'string' || typeof v.create !== 'function') throw new Error(`visualization '${v.id}' needs a label and a create(ctx, kit) function`);
      if (seen.has(v.id)) throw new Error(`visualization '${v.id}' is declared twice`);
      seen.add(v.id);
    }
    compiled.set(code, result as Visualization[]);
    return result as Visualization[];
  } catch (e) {
    const error = new Error(`The visualizations of this metamodel could not be loaded: ${(e as Error).message}`);
    compiled.set(code, error);
    throw error;
  }
}

/** The prefix of the name of a view that a metamodel brings. */
export const VISUALIZATION_PREFIX = 'viz:';

/**
 * The views a metamodel's visualizations make, from the text of its file: one for each visualization, or a single one that carries
 * the reason when the file does not load. Nothing when it has none.
 */
export function visualizationViews(code: string | undefined): ViewInfo[] {
  if (code === undefined) return [];
  try {
    return loadVisualizations(code).map((v): ViewInfo => ({ id: VISUALIZATION_PREFIX + v.id, label: v.label, kind: 'visualization', description: v.description }));
  } catch (e) {
    return [{ id: `${VISUALIZATION_PREFIX}!`, label: 'Visualizations', kind: 'visualization', error: (e as Error).message }];
  }
}
