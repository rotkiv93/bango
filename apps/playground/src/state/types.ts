import type { BuildResult, CompositionInfo, GrammarInfo, InstanceState, MetamodelCase, Range0, SelectionCheck } from '@bango/core';
import type { ViewKind } from '@bango/renderer';
import type { Workspace } from '../types.js';

export type Page = 'projects' | 'project' | 'metamodels';
export type Theme = 'dark' | 'light';
export type MetamodelView = 'grammar' | 'constraints' | 'spec' | 'tests' | 'ast' | 'composed';
export type OverviewView = 'diagram' | 'project-json' | 'project-ast';
interface Toast { id: number; kind: 'error' | 'success' | 'info'; text: string }

/** Why a project could not be created or changed (the composer's answer, in plain language). */
type SelectionResult = { ok: true } | { ok: false; errors: string[]; suggested: string[] };

/** The two kinds of script a metamodel can own, besides its grammar: where they live in the workspace and how they reach the worker. */
export type ScriptKind = 'constraints' | 'spec';

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

/** What is saved and what the worker knows: the workspace, the open project, and the engine's answers about them. */
export interface WorkspaceSlice {
  workspace: Workspace;
  activeProject?: string;
  composition?: CompositionInfo;
  /** every grammar of the workspace: the metamodels a project can choose from, plus libraries */
  catalog: GrammarInfo[];
  /** status of the open project's instances, mirrored from the engine */
  instances: InstanceState[];
  ready: boolean;
  build?: { result: BuildResult; project: string };
  building: boolean;

  init(): Promise<void>;
  checkSelection(selection: string[]): Promise<SelectionCheck>;
  createProject(name: string, selection: string[]): Promise<SelectionResult>;
  openProject(name: string): Promise<void>;
  deleteProject(name: string): Promise<void>;
  setProjectMetamodels(selection: string[]): Promise<SelectionResult>;
  buildProject(): Promise<void>;
  createInstance(metamodel: string): Promise<void>;
  removeInstance(metamodel: string): Promise<void>;
  editGrammar(name: string, text: string): void;
  editConstraints(metamodel: string, text: string): void;
  editSpec(metamodel: string, text: string): void;
  setCases(metamodel: string, cases: MetamodelCase[]): void;
  /** the first visit to a script view creates the metamodel's (template) script */
  ensureScript(kind: ScriptKind, metamodel: string): void;
  addGrammar(name: string): Promise<void>;
  reset(): Promise<void>;
}

export type State = UiSlice & WorkspaceSlice;
