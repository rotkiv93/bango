import * as monaco from 'monaco-editor/editor/editor.api';
import './monaco-features.js';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { registerTextRenderer } from '@bango/renderer/text';

// Monaco's own web workers are the page's business; the library only needs the namespace. The TypeScript worker (several MB)
// is only created when a script editor turns the language service on (see script-intelligence.ts).
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'javascript' || label === 'typescript' ? new TsWorker() : new EditorWorker())
};

// adds the `text` view to every ModelRenderer on this page
registerTextRenderer(monaco);

export { monaco };
