// Entry of the self-contained browser build (dist/bundle/bango.js): the engine side, for pages that run it in-process.
// A page that only talks to a worker needs `@bango/core/bundle/client` instead, which has no Langium.
export * from '../index.js';
export { serveBango } from '../worker/index.js';
export { ModelComposer, Composition } from '@bango/composer';
