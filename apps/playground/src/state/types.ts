import type { CaseResult, ImportResult, JsonValue, MetamodelCase, Range0, SelectionCheck } from '@bango/core';
import type { ScriptKind, SelectionResult, WorkspaceState } from '@bango/engine/workspace';
import type { ViewKind } from '@bango/renderer';

export type Page = 'projects' | 'project' | 'metamodels';
export type Theme = 'dark' | 'light';
export type MetamodelView = 'grammar' | 'constraints' | 'spec' | 'import' | 'tests' | 'ast' | 'composed';
export type OverviewView = 'diagram' | 'project-json' | 'project-ast';
interface Toast { id: number; kind: 'error' | 'success' | 'info'; text: string }


/** What the user is looking at: pages, tabs, views, theme, toasts. */
export interface UiSlice {
  theme: Theme;
  toasts: Toast[];
  page: Page;
  /** `overview` or the name of a metamodel of the open project */
  activeTab: string;
  instanceView: ViewKind;
  /** show the text next to the chosen view */
  split: boolean;
  overviewView: OverviewView;
  activeGrammar?: string;
  metamodelView: MetamodelView;
  /** asks the instance view to select a range (diagram/form/AST -> text) */
  reveal?: { metamodel: string; range: Range0; nonce: number };

  go(page: Page): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  initTheme(): void;
  toggleTheme(): void;
  selectTab(tab: string): void;
  setInstanceView(view: ViewKind): void;
  setSplit(split: boolean): void;
  setOverviewView(view: OverviewView): void;
  revealInText(metamodel: string, range: Range0): void;
  selectGrammar(name: string): void;
  setMetamodelView(view: MetamodelView): void;
}

/** The library's `WorkspaceController` state (workspace, open project, engine answers), plus what a screen does after each action. */
export interface WorkspaceSlice extends WorkspaceState {

  init(): Promise<void>;
  checkSelection(selection: string[]): Promise<SelectionCheck>;
  createProject(name: string, selection: string[]): Promise<SelectionResult>;
  openProject(name: string): Promise<void>;
  deleteProject(name: string): Promise<void>;
  setProjectMetamodels(selection: string[]): Promise<SelectionResult>;
  buildProject(): Promise<void>;
  createInstance(metamodel: string): Promise<void>;
  removeInstance(metamodel: string): Promise<void>;
  /** go back or forward through the changes of an instance (the engine keeps the history) */
  undo(metamodel: string): Promise<void>;
  redo(metamodel: string): Promise<void>;
  editGrammar(name: string, text: string): void;
  editConstraints(metamodel: string, text: string): void;
  editSpec(metamodel: string, text: string): void;
  editImport(metamodel: string, text: string): void;
  setCases(metamodel: string, cases: MetamodelCase[]): void;
  runCases(metamodel: string, cases?: MetamodelCase[]): Promise<CaseResult[]>;
  /** what importing this JSON into the open project would produce; changes nothing */
  previewImport(json: JsonValue): Promise<ImportResult>;
  /** replace the open project's instances with imported ones (the other instances stay) */
  applyImport(texts: Record<string, string>): Promise<void>;
  /** the first visit to a script view creates the metamodel's (template) script */
  ensureScript(kind: ScriptKind, metamodel: string): void;
  /** switch a script that made the engine stop answering back on */
  reenableScript(kind: ScriptKind, metamodel: string): void;
  addGrammar(name: string): Promise<void>;
  reset(): Promise<void>;
}

export type State = UiSlice & WorkspaceSlice;
