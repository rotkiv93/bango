import { connectBango } from '@bango/core/client';

/** The library, running in a worker. Everything Langium happens behind this object. */
// given the function that makes the worker, the connection notices an engine that stops answering (a script in a loop) and replaces it
export const bango = connectBango(() => new Worker(new URL('../bango.worker.ts', import.meta.url), { type: 'module' }));
