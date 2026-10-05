import { AstRenderer } from '../views/ast/ast-renderer.js';
import { DiagramRenderer } from '../views/diagram/diagram-renderer.js';
import { FormRenderer } from '../views/form/form-renderer.js';
import { JsonRenderer } from '../views/json/json-renderer.js';
import type { RendererFactory, ViewKind } from './types.js';

const factories = new Map<string, RendererFactory>([
  ['form', ctx => new FormRenderer(ctx)],
  ['diagram', ctx => new DiagramRenderer(ctx)],
  ['ast', ctx => new AstRenderer(ctx, 'instance')],
  ['project-ast', ctx => new AstRenderer(ctx, 'project')],
  ['json', ctx => new JsonRenderer(ctx, 'instance')],
  ['project-json', ctx => new JsonRenderer(ctx, 'project')]
]);

/** Add a view, or replace a built-in one. `text` is added by `registerTextRenderer(monaco)`. */
export function registerRenderer(kind: ViewKind, factory: RendererFactory): void {
  factories.set(kind, factory);
}

export function getRenderer(kind: ViewKind): RendererFactory {
  const factory = factories.get(kind);
  if (!factory) {
    const hint = kind === 'text' ? " Call registerTextRenderer(monaco) from '@bango/renderer/text' first." : '';
    throw new Error(`No renderer registered for view '${kind}'.${hint}`);
  }
  return factory;
}

export const registeredViews = () => [...factories.keys()];
