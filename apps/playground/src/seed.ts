import { parseSeed, workspaceFromSeed, type WorkspaceData } from '@bango/engine/workspace';

const raw = import.meta.glob('../../../examples/seed/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The examples shipped in `examples/seed`: the library knows the folder layout, the build only has to list the files. */
export function seedWorkspace(): WorkspaceData {
  const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.slice(path.indexOf('/seed/') + '/seed/'.length), text]));
  return workspaceFromSeed(parseSeed(files));
}
