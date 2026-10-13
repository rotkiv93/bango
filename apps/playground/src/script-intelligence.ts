import { monaco } from './monaco.js';
import { javascriptMonarch } from '@bango/renderer/text';

type Contribution = typeof import('monaco-editor/language/typescript/monaco.contribution');

let loading: Promise<Contribution> | undefined;

/**
 * Monaco's TypeScript/JavaScript service, for the editors of constraints and JSON mappings: completion on the nodes of the metamodel,
 * hover, and errors for a misspelled property. It brings a worker of several MB, so nothing loads until a script editor is first opened.
 */
export function loadScriptIntelligence(): Promise<Contribution> {
  loading ??= import('monaco-editor/language/typescript/monaco.contribution').then(ts => {
    monaco.languages.register({ id: 'javascript', extensions: ['.js'], aliases: ['JavaScript'] });
    monaco.languages.setMonarchTokensProvider('javascript', javascriptMonarch);
    ts.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      checkJs: true,
      allowNonTsExtensions: true,
      strictNullChecks: true,
      target: ts.ScriptTarget.ES2022,
      lib: ['es2022']
    });
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      // a script is a function body, so it `return`s at the top level
      diagnosticCodesToIgnore: [1108]
    });
    return ts;
  });
  return loading;
}

let typings: { dispose(): void } | undefined;

/** Make `dts` (the typings of a metamodel, from `bango.getTypings`) the global declarations scripts are checked against. */
export async function useTypings(dts: string) {
  const ts = await loadScriptIntelligence();
  typings?.dispose();
  typings = ts.javascriptDefaults.addExtraLib(dts, 'file:///bango/typings.d.ts');
}
