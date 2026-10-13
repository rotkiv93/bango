/**
 * TypeScript declarations for the text of a metamodel's `<name>.visualizations.js`, for an editor that wants to complete and check it
 * (`monaco.languages.typescript.javascriptDefaults.addExtraLib(VISUALIZATION_TYPINGS)`). Write the file as the body of a function:
 *
 *   // @ts-check
 *   /** @type {Visualizations} *\/
 *   return [{ id: 'x', label: 'X', create(ctx, kit) { ... } }];
 */
export const VISUALIZATION_TYPINGS = `
interface Range0 { startLine: number; startColumn: number; endLine: number; endColumn: number }
interface PathStep { feature: string; index?: number | undefined }
interface RefDto { text: string; resolved: boolean; targetType?: string; targetName?: string; targetMetamodel?: string }
interface AstDto {
  type: string;
  name?: string;
  range?: Range0;
  props: Record<string, string | number | boolean | (string | number | boolean)[]>;
  refs: Record<string, RefDto | RefDto[]>;
  children: Record<string, AstDto | AstDto[]>;
}
interface Problem { severity: 'error' | 'warning' | 'info'; message: string; range?: Range0 }
interface InstanceState { metamodel: string; text: string; ast?: AstDto; problems: Problem[]; available: boolean; stale: boolean }
/** A read-only instance from outside the project (a module offers it): who offers it, and its tree. */
interface OfferedInstance { origin: string; metamodel: string; text: string; readOnly: true; ast?: AstDto; problems: Problem[]; available: boolean }
/** What a visualization draws: the instance, and what is offered for any metamodel (the ones that could be read). */
interface VisualizationState extends InstanceState { offered: OfferedInstance[] }
interface EngineApi {
  getInstance(metamodel: string): Promise<InstanceState>;
  getInstances(): Promise<InstanceState[]>;
  toJson(metamodel: string): Promise<unknown>;
}

type Positions = Record<string, { x: number; y: number }>;
type EdgeEnd = 'none' | 'arrow' | 'triangle' | 'diamond';
interface CanvasNode { id: string; el: SVGElement; width: number; height: number; handle?: boolean; fixed?: boolean }
interface CanvasEdge { id: string; from: string; to: string; color?: string; dashed?: boolean; start?: EdgeEnd; end?: EdgeEnd; fromLabel?: string; toLabel?: string; label?: string }
interface CanvasOptions {
  onSelect?(id: string | null): void;
  onOpen?(id: string): void;
  onDelete?(id: string): void;
  onConnect?(from: string, to: string, modifiers: { shift: boolean }): void;
  onMove?(positions: Positions): void;
}
interface BoxNode { id: string; width: number; height: number }
interface BoxLayoutOptions { hierarchy?: [string, string][]; links?: [string, string][]; direction?: 'down' | 'right'; gap?: number; maxWidth?: number }

/** A canvas of nodes you draw, that can be dragged, joined by edges, panned and zoomed. */
declare class Canvas {
  constructor(options?: CanvasOptions);
  readonly el: HTMLElement;
  /** put your buttons here */
  readonly toolbar: HTMLElement;
  readonly selected: string | null;
  mount(parent: HTMLElement): void;
  /** draw; \`saved\` are the positions people left the nodes at, and a node without one is laid out below the others */
  render(nodes: CanvasNode[], edges: CanvasEdge[], saved?: Positions, layout?: BoxLayoutOptions): void;
  positions(): Positions;
  autoLayout(layout?: BoxLayoutOptions): void;
  select(id: string | null): void;
  fit(): void;
  zoom(factor: number): void;
  dispose(): void;
}

interface Editor {
  add(path: PathStep[], feature: string, type?: string): Promise<PathStep[] | undefined>;
  addNamed(path: PathStep[], feature: string, type: string | undefined, name: string): Promise<PathStep[] | undefined>;
  addValue(path: PathStep[], feature: string, value: string): Promise<boolean>;
  set(path: PathStep[], feature: string, value: string | number | boolean | null, index?: number): Promise<boolean>;
  remove(path: PathStep[], feature?: string, index?: number): Promise<boolean>;
}

interface VisualizationKit {
  h: <K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, ...children: (Node | string | number | null | undefined | false)[]) => HTMLElementTagNameMap[K];
  svg: <K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number>, ...children: (Node | string | number | null | undefined | false)[]) => SVGElementTagNameMap[K];
  clear(el: Node): void;
  asArray<T>(value: T | T[] | undefined): T[];
  Canvas: typeof Canvas;
  boxLayout(nodes: BoxNode[], options?: BoxLayoutOptions): Positions;
  columnLayout(columns: BoxNode[][], options?: { gap?: number }): Positions;
  walk(ast: AstDto, visit: (node: AstDto, path: PathStep[]) => void): void;
  nodeAt(ast: AstDto, path: PathStep[]): AstDto | undefined;
  /** edits the instance by its tree; what the grammar refuses is reported to \`onFailure\` */
  editor(engine: EngineApi, metamodel: string, onFailure?: (message: string) => void): Editor;
  fit(text: string, width: number): string;
}

interface VisualizationContext {
  engine: EngineApi;
  /** the metamodel whose instance is shown */
  metamodel: string;
  /** ask the host to show a position of the text */
  reveal(metamodel: string, range: Range0): void;
  /** where the nodes of this view are; the host keeps it */
  layout: { get(): Positions; set(positions: Positions): void };
  /** show the node at the path in the inspector (a form for it alone); \`null\` closes it */
  inspect(path: PathStep[] | null): void;
}

interface InstanceRenderer {
  mount(el: HTMLElement): void | Promise<void>;
  /** the instance (or any other instance, or a metamodel) changed: draw again */
  update(state: VisualizationState): void | Promise<void>;
  reveal?(range: Range0): void;
  dispose(): void;
}

interface Visualization {
  /** letters, digits, - and _; the view is called viz:id */
  id: string;
  label: string;
  description?: string;
  create(ctx: VisualizationContext, kit: VisualizationKit): InstanceRenderer;
}
type Visualizations = Visualization[];

declare const kit: VisualizationKit;
`;
