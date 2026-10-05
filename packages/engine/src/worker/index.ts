import * as Comlink from 'comlink';
import { Bango } from '../facade/bango.js';
import type { BangoApi, EngineEvent, Unsubscribe } from '../types.js';

/** Over a worker boundary the unsubscribe function has to travel by reference. */
class BangoWorkerHost extends Bango {
  override async subscribe(listener: (event: EngineEvent) => void): Promise<Unsubscribe> {
    const unsubscribe = await super.subscribe(listener);
    return Comlink.proxy(unsubscribe);
  }
}

/** Run inside a worker: `serveBango()` makes the worker answer the `BangoApi` that `connectBango` consumes. */
export function serveBango(endpoint: Comlink.Endpoint = self as unknown as Comlink.Endpoint): void {
  Comlink.expose(new BangoWorkerHost(), endpoint);
}

const METHODS = [
  'setGrammar', 'removeGrammar', 'setConstraints', 'setSpec', 'compose', 'bundleText', 'getGrammarAst', 'listMetamodels', 'checkSelection',
  'getInstance', 'getInstances', 'getComposition', 'setText', 'setInstances', 'createInstance', 'removeInstance', 'applyEdit',
  'getFormSchema', 'toJson', 'toProjectJson', 'getRefCandidates', 'complete', 'hover', 'definition', 'build'
] as const;

export interface BangoConnection extends BangoApi {
  /** stop talking to the worker (does not terminate it) */
  disconnect(): void;
}

/** Talk to a worker that called `serveBango()`. The result has the same async API as a local `Bango`. */
export function connectBango(worker: Comlink.Endpoint): BangoConnection {
  const remote = Comlink.wrap<BangoApi>(worker) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  // explicit methods rather than a Proxy: a Remote looks "thenable" and would break `await connectBango(...)`
  const api: Record<string, unknown> = {};
  for (const m of METHODS) api[m] = (...args: unknown[]) => remote[m](...args);
  api.subscribe = async (listener: (event: EngineEvent) => void): Promise<Unsubscribe> => {
    const unsubscribe = (await remote.subscribe(Comlink.proxy(listener))) as unknown as () => Promise<void>;
    return () => { void unsubscribe(); };
  };
  api.disconnect = () => (remote as unknown as { [Comlink.releaseProxy]: () => void })[Comlink.releaseProxy]();
  return api as unknown as BangoConnection;
}
