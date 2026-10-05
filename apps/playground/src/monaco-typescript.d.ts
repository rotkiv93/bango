// Monaco ships no declarations for this subpath: it is the TypeScript/JavaScript language service. Only what the playground uses.
declare module 'monaco-editor/language/typescript/monaco.contribution' {
  export const ScriptTarget: { readonly ES2022: number };
  export const javascriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    setDiagnosticsOptions(options: { noSemanticValidation?: boolean; noSyntaxValidation?: boolean; diagnosticCodesToIgnore?: number[] }): void;
    addExtraLib(content: string, filePath?: string): { dispose(): void };
  };
}
