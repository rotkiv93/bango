import { connectBango } from '@bango/core/client';
import { VisualizationStore, type LayoutStore } from '@bango/renderer';

/** The library, running in a worker. Everything Langium happens behind this object. */
// given the function that makes the worker, the connection notices an engine that stops answering (a script in a loop) and replaces it
export const bango = connectBango(() => new Worker(new URL('../bango.worker.ts', import.meta.url), { type: 'module' }));

/** The views the metamodels of the workspace bring (their `<name>.visualizations.js`), kept in step with the workspace by the store. */
export const visualizations = new VisualizationStore();

/** Where the visualizations keep their nodes: the open project (the store points it at the workspace). */
export const layouts: LayoutStore & { use(store: LayoutStore): void } = (() => {
  let target: LayoutStore | undefined;
  return {
    use: store => { target = store; },
    get: (metamodel, view) => target?.get(metamodel, view) ?? {},
    set: (metamodel, view, positions) => target?.set(metamodel, view, positions)
  };
})();
