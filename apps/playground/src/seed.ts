import type { Workspace } from './types.js';

const raw = import.meta.glob('../../../examples/seed/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The examples shipped in `examples/seed`: shared metamodels, plus one folder per project. */
export function seedWorkspace(): Workspace {
  const workspace: Workspace = { grammars: {}, constraints: {}, specs: {}, projects: {} };
  const projectFiles = new Map<string, Record<string, string>>();

  for (const [path, text] of Object.entries(raw)) {
    const rel = path.slice(path.indexOf('/seed/') + '/seed/'.length);
    const parts = rel.split('/');
    if (parts[0] === 'grammars' && parts.length === 2) {
      if (parts[1].endsWith('.constraints.js')) workspace.constraints[parts[1].replace(/\.constraints\.js$/, '')] = text;
      else if (parts[1].endsWith('.spec.js')) workspace.specs[parts[1].replace(/\.spec\.js$/, '')] = text;
      else workspace.grammars[parts[1].replace(/\.langium$/, '')] = text;
    } else if (parts[0] === 'projects' && parts.length === 3) {
      projectFiles.set(parts[1], { ...projectFiles.get(parts[1]), [parts[2]]: text });
    }
  }

  for (const [name, files] of projectFiles) {
    const instances: Record<string, string> = {};
    for (const [file, text] of Object.entries(files)) if (file.endsWith('.instance')) instances[file.replace(/\.instance$/, '')] = text;
    const manifest = JSON.parse(files['project.json'] ?? '{}');
    // fixtures for tests that show what the composer rejects: not offered as examples
    if (manifest.playground === false) continue;
    workspace.projects[name] = { name, metamodels: manifest.metamodels ?? [], instances };
  }
  return workspace;
}
