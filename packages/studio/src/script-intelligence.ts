import type { MonacoApi, RendererLibrary, TypescriptService } from './types.js';

/** What was set up on each Monaco: its TypeScript service is global to it, so it is configured once and its typings replaced as needed. */
interface Setup {
  service: Promise<TypescriptService>;
  typings?: { dispose(): void } | undefined;
}

const setups = new WeakMap<object, Setup>();

/**
 * Turns on Monaco's TypeScript/JavaScript service for the script editors (constraints, scope, JSON mapping and import): completion on the
 * nodes of the metamodel, hover, and errors for a misspelled property. It brings a worker of several MB, so nothing loads until a script
 * editor is first opened. Rejects when the page gave no way to load it, or it cannot load: the script editors stay plain.
 */
export function loadScriptIntelligence(args: { monaco: MonacoApi; renderer: RendererLibrary; load: (() => Promise<TypescriptService>) | undefined }): Promise<TypescriptService> {
  const { monaco, renderer, load } = args;
  if (!load) return Promise.reject(new Error('no TypeScript service was given'));
  let setup = setups.get(monaco);
  if (!setup) {
    setup = {
      service: load().then(ts => {
        monaco.languages.register({ id: 'javascript', extensions: ['.js'], aliases: ['JavaScript'] });
        monaco.languages.setMonarchTokensProvider('javascript', renderer.javascriptMonarch);
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
      })
    };
    setups.set(monaco, setup);
  }
  return setup.service;
}

/** Make `dts` (the typings of a metamodel, from `bango.getTypings`) the global declarations scripts are checked against. */
export async function useTypings(args: { monaco: MonacoApi; renderer: RendererLibrary; load: (() => Promise<TypescriptService>) | undefined; dts: string }): Promise<void> {
  const ts = await loadScriptIntelligence(args);
  const setup = setups.get(args.monaco)!;
  setup.typings?.dispose();
  setup.typings = ts.javascriptDefaults.addExtraLib(args.dts, 'file:///bango/typings.d.ts');
}
