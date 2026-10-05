import * as Comlink from 'comlink';
import { Bango } from '../facade/bango.js';
import type { EngineEvent, Unsubscribe } from '../types.js';

/** Over a worker boundary the unsubscribe function has to travel by reference. */
class BangoWorkerHost extends Bango {
  override async subscribe(listener: (event: EngineEvent) => void): Promise<Unsubscribe> {
    const unsubscribe = await super.subscribe(listener);
    return Comlink.proxy(unsubscribe);
  }
}

/** Run inside a worker: `serveBango()` makes the worker answer the `BangoApi` that `connectBango` (in `@bango/core/client`) consumes. */
export function serveBango(endpoint: Comlink.Endpoint = self as unknown as Comlink.Endpoint): void {
  Comlink.expose(new BangoWorkerHost(), endpoint);
}
