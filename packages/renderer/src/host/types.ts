import type { EngineApi, InstanceState, Range0 } from '@bango/engine';

/** Built-in views are `text`, `form`, `diagram`, `ast`, `json` and the project-wide `project-ast` and `project-json`; anything registered with `registerRenderer` works too. */
export type ViewKind = 'text' | 'form' | 'diagram' | 'ast' | 'project-ast' | (string & {});

export interface RenderContext {
  engine: EngineApi;
  /** the metamodel whose instance this view is showing */
  metamodel: string;
  /** ask the host to show a source position (the default host switches to the text view) */
  reveal(metamodel: string, range: Range0): void;
}

/**
 * One way of showing an instance. Renderers never touch Langium: they read plain state from the engine
 * and write back through `engine.setText` / `engine.applyEdit`.
 */
export interface InstanceRenderer {
  /** create the DOM inside `el` */
  mount(el: HTMLElement): void | Promise<void>;
  /** the instance changed (or the metamodels did): refresh what is shown */
  update(state: InstanceState): void | Promise<void>;
  /** select and show a source range (text-like views) */
  reveal?(range: Range0): void;
  /** remove listeners and DOM */
  dispose(): void;
}

export type RendererFactory = (ctx: RenderContext) => InstanceRenderer;
