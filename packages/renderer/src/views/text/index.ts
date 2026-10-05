import type * as Monaco from 'monaco-editor/editor/editor.api';
import { registerRenderer } from '../../host/registry.js';
import { registerCodeLanguages } from './code-editor.js';
import { TextRenderer, type TextRendererOptions } from './text-renderer.js';

export { CodeEditor, registerCodeLanguages, type CodeEditorOptions } from './code-editor.js';
export { TextRenderer, languageIdOf, modelUri, type TextRendererOptions } from './text-renderer.js';
export { monarchFor } from './monarch.js';

/**
 * Registers the `text` view (Monaco). Pass the Monaco namespace you already use, so the library never bundles
 * a second copy; with a CDN build that is `window.monaco`. Monaco's own web workers are the page's business.
 */
export function registerTextRenderer(monaco: typeof Monaco, options: TextRendererOptions = {}) {
  registerCodeLanguages(monaco);
  registerRenderer('text', ctx => new TextRenderer(monaco, ctx, options));
}
