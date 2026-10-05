// Entry of the self-contained browser build (dist/bundle/bango.js): everything a page needs from the engine side.
export * from '../index.js';
export { connectBango, serveBango, type BangoConnection } from '../worker/index.js';
export { ModelComposer, Composition } from '@bango/composer';
