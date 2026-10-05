import * as monaco from 'monaco-editor/editor/editor.api';
import './monaco-features.js';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { registerTextRenderer } from '@bango/renderer/text';

// Monaco's own web worker is the page's business; the library only needs the namespace
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

// adds the `text` view to every ModelRenderer on this page
registerTextRenderer(monaco);

export { monaco };
