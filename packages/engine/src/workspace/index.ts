// Projects, metamodels and their scripts on top of one engine, without a UI. Imports only `@bango/core`: no Langium, so a page that talks
// to an engine in a worker can use it without loading the parser.
export { WorkspaceController, type Outcome, type ScriptKind, type SelectionResult, type WorkspaceOptions, type WorkspaceState } from './controller.js';
export { MemoryStorage, emptyWorkspace, migrateWorkspace, type ProjectData, type WorkspaceData, type WorkspaceStorage } from './data.js';
export { KeyedDebouncer } from './debounce.js';
export { parseSeed, workspaceFromSeed, type Seed, type SeedProject } from './seed.js';
export { CONSTRAINTS_TEMPLATE, IMPORT_TEMPLATE, SCOPE_TEMPLATE, SPEC_TEMPLATE, grammarTemplate } from './templates.js';
export { validateMetamodelName, validateProjectName } from './validation.js';
