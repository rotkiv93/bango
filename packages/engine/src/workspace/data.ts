import type { MetamodelCase } from '@bango/core';

/** A project picks the metamodels it uses and owns one instance (text) per metamodel. */
export interface ProjectData {
  name: string;
  /** metamodel (grammar) names */
  metamodels: string[];
  /** metamodel name -> instance text */
  instances: Record<string, string>;
}

/** Everything that is saved: the metamodels shared by every project (with their scripts and tests), plus the projects. */
export interface WorkspaceData {
  /** grammar name (file name without extension) -> Langium text */
  grammars: Record<string, string>;
  /** metamodel name -> constraints code */
  constraints: Record<string, string>;
  /** metamodel name -> JSON mapping code: the piece of the product specification the metamodel owns */
  specs: Record<string, string>;
  /** metamodel name -> import mapping code: the inverse of its JSON mapping */
  imports: Record<string, string>;
  /** grammar name -> scope code: which nodes each reference of the grammar can point at */
  scopes: Record<string, string>;
  /** metamodel name -> its test cases: sample instances and what they must report */
  cases: Record<string, MetamodelCase[]>;
  projects: Record<string, ProjectData>;
}

export const emptyWorkspace = (): WorkspaceData => ({ grammars: {}, constraints: {}, specs: {}, imports: {}, scopes: {}, cases: {}, projects: {} });

/**
 * A workspace saved by an older version lacks what was added since. Specs were never seeded on their own, so an old workspace simply has
 * none; import mappings and test cases start from `seed` (the examples). Everything the user wrote is kept.
 */
export function migrateWorkspace(saved: Partial<WorkspaceData>, seed: () => WorkspaceData): WorkspaceData {
  const needsSeed = saved.imports === undefined || saved.cases === undefined || saved.scopes === undefined;
  const seeded = needsSeed ? seed() : emptyWorkspace();
  return {
    grammars: saved.grammars ?? {},
    constraints: saved.constraints ?? {},
    specs: saved.specs ?? {},
    imports: saved.imports ?? seeded.imports,
    scopes: saved.scopes ?? seeded.scopes,
    cases: saved.cases ?? seeded.cases,
    projects: saved.projects ?? {}
  };
}

/** Where a workspace is kept between sessions: the browser's IndexedDB, a file, memory for tests. The library does not care. */
export interface WorkspaceStorage {
  load(): Promise<Partial<WorkspaceData> | undefined>;
  save(data: WorkspaceData): Promise<void>;
}

export class MemoryStorage implements WorkspaceStorage {
  constructor(public saved?: WorkspaceData) {}
  async load() { return this.saved && structuredClone(this.saved); }
  async save(data: WorkspaceData) { this.saved = structuredClone(data); }
}
