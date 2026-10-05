import * as Comlink from 'comlink';
import { ManagedClient, type ConnectOptions, type RestartInfo, type ScriptRef, type WorkerHandle } from './managed-client.js';
import type { BangoApi, EngineEvent, Unsubscribe } from './types.js';

export { EngineRestartedError, ScriptTimeoutError, type ConnectOptions, type RestartInfo, type ScriptKind, type ScriptRef, type WorkerHandle } from './managed-client.js';

const METHODS = [
  'setGrammar', 'removeGrammar', 'setConstraints', 'setSpec', 'setImport', 'compose', 'bundleText', 'getGrammarAst', 'listMetamodels', 'checkSelection', 'getTypings', 'runCases',
  'getInstance', 'getInstances', 'getComposition', 'setText', 'setInstances', 'createInstance', 'removeInstance', 'applyEdit',
  'getFormSchema', 'toJson', 'toProjectJson', 'getRefCandidates', 'importJson', 'complete', 'hover', 'definition', 'references', 'symbols', 'rename', 'quickFixes', 'applyQuickFix', 'undo', 'redo', 'build'
] as const;

export interface BangoConnection extends BangoApi {
  /** stop talking to the worker (a connection made from a factory also terminates it) */
  disconnect(): void;
  /** the engine was restarted because it stopped answering (only for a connection made from a factory) */
  onRestart(listener: (info: RestartInfo) => void): () => void;
  /** the scripts that are switched off because the engine stopped answering with them on */
  quarantined(): ScriptRef[];
}

/**
 * Talk to a worker that called `serveBango()`. The result has the same async API as a local `Bango`.
 *
 * Give it **a function that makes the worker** (`() => new Worker(...)`) and it also watches the engine: when it stops answering,
 * typically because a constraint or mapping of a metamodel loops forever, the worker is replaced and the culprit script switched off
 * (see `ManagedClient`). Give it the worker itself and it is a plain connection, with no recovery.
 */
export function connectBango(source: Comlink.Endpoint | (() => WorkerHandle), options?: ConnectOptions): BangoConnection {
  if (typeof source === 'function') return new ManagedClient(source, options).api(METHODS) as unknown as BangoConnection;

  const remote = Comlink.wrap<BangoApi>(source) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  // explicit methods rather than a Proxy: a Remote looks "thenable" and would break `await connectBango(...)`
  const api: Record<string, unknown> = {};
  for (const m of METHODS) api[m] = (...args: unknown[]) => remote[m](...args);
  api.subscribe = async (listener: (event: EngineEvent) => void): Promise<Unsubscribe> => {
    const unsubscribe = (await remote.subscribe(Comlink.proxy(listener))) as unknown as () => Promise<void>;
    return () => { void unsubscribe(); };
  };
  api.onRestart = () => () => undefined;
  api.quarantined = () => [];
  api.disconnect = () => (remote as unknown as { [Comlink.releaseProxy]: () => void })[Comlink.releaseProxy]();
  return api as unknown as BangoConnection;
}
