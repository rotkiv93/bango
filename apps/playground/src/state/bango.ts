import { connectBango } from '@bango/core/client';

/** The library, running in a worker. Everything Langium happens behind this object. */
export const bango = connectBango(new Worker(new URL('../bango.worker.ts', import.meta.url), { type: 'module' }));
