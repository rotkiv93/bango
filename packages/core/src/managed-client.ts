import * as Comlink from 'comlink';
import type { BangoApi, EngineEvent, InstanceState, JsonValue, Unsubscribe } from './types.js';

export type ScriptKind = 'constraints' | 'spec' | 'import' | 'scope';

/** One of the scripts a metamodel owns, besides its grammar. */
export interface ScriptRef {
  kind: ScriptKind;
  metamodel: string;
}

/** What the client reports when it had to restart the engine. */
export interface RestartInfo {
  /** the call that stopped answering */
  call: string;
  /** every script that is switched off now, because the engine stopped answering while it was active */
  quarantined: ScriptRef[];
}

/** The call did not finish in time: the engine (a script it was running, almost always) is stuck, and was restarted. */
export class ScriptTimeoutError extends Error {
  constructor(readonly call: string, readonly timeoutMs: number) {
    super(`'${call}' did not finish in ${timeoutMs / 1000} s, so the engine was restarted. A script of a metamodel is probably in an endless loop: it has been switched off.`);
    this.name = 'ScriptTimeoutError';
  }
}

/** The call was waiting on an engine that was restarted because another call got stuck: ask again. */
export class EngineRestartedError extends Error {
  constructor(readonly call: string) {
    super(`'${call}' was cancelled: the engine was restarted because another call did not finish.`);
    this.name = 'EngineRestartedError';
  }
}

/** A Web Worker, or anything that can be talked to with Comlink and stopped. */
export interface WorkerHandle extends Comlink.Endpoint {
  terminate?(): void;
  close?(): void;
}

export interface ConnectOptions {
  /** how long the engine may go without finishing any call while one is waiting (default 10 s) */
  timeoutMs?: number;
  /** how long one step of checking a script after a restart may take (default: the timeout, at most 5 s) */
  probeTimeoutMs?: number;
  onRestart?(info: RestartInfo): void;
}

type Remote = Record<string, (...args: unknown[]) => Promise<unknown>>;
type Listener = (event: EngineEvent) => void;

interface Flight {
  method: string;
  reject(error: Error): void;
}

class Stalled extends Error {}

const SCRIPT_SETTERS = { setConstraints: 'constraints', setSpec: 'spec', setImport: 'import', setScope: 'scope' } as const;
const keyOf = (ref: ScriptRef) => `${ref.kind}:${ref.metamodel}`;

/**
 * A connection to an engine in a worker that notices when the engine stops answering. User scripts (constraints, JSON and import
 * mappings) are code, and code can loop: the worker then never answers again. This client watches for **no call finishing for
 * `timeoutMs` while one is waiting**, and then
 *
 * 1. rejects the calls in flight (`ScriptTimeoutError` for the oldest, `EngineRestartedError` for the others),
 * 2. terminates the worker and starts a new one from the factory,
 * 3. replays what it knows (grammars, the last composition, the instance texts, subscriptions) **without any script**,
 * 4. switches the scripts back on one at a time, each followed by a short check (compose, set the instances, export, import); a script
 *    after which the engine stops answering again is **quarantined**: left off, and reported in `onRestart` and `quarantined()`.
 *
 * Sending a script again (an edit) takes it out of quarantine. What a restart loses: the undo history of the instances.
 */
export class ManagedClient {
  private handle!: WorkerHandle;
  private remote!: Remote;
  private readonly timeoutMs: number;
  private readonly probeMs: number;

  /** what is replayed into a new worker */
  private grammars = new Map<string, string>();
  private scripts = new Map<string, ScriptRef & { code: string }>();
  /** the last composition asked for (`null`: every metamodel); undefined before the first */
  private selection: string[] | null | undefined;
  private texts = new Map<string, string>();
  private quarantine = new Map<string, ScriptRef>();
  private listeners = new Map<Listener, { unsubscribe?: () => void }>();
  private restartListeners = new Set<(info: RestartInfo) => void>();

  private inflight = new Set<Flight>();
  private lastProgress = 0;
  private watching = false;
  private recovering?: Promise<void>;
  private closed = false;

  constructor(private readonly factory: () => WorkerHandle, private readonly options: ConnectOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.probeMs = options.probeTimeoutMs ?? Math.min(this.timeoutMs, 5_000);
    if (options.onRestart) this.restartListeners.add(options.onRestart);
    this.spawn();
  }

  // ------------------------------------------------------------------- workers

  private spawn() {
    this.handle = this.factory();
    this.remote = Comlink.wrap<BangoApi>(this.handle) as unknown as Remote;
  }

  private stop() {
    try { (this.remote as unknown as { [Comlink.releaseProxy]?: () => void })[Comlink.releaseProxy]?.(); } catch { /* already gone */ }
    try { this.handle.terminate?.(); } catch { /* already gone */ }
    try { this.handle.close?.(); } catch { /* already gone */ }
  }

  // ------------------------------------------------------------- calls and watch

  /** A call on the current worker that the watchdog follows. Calls made while the engine is being restarted wait for it. */
  private raw<T>(method: string, args: unknown[]): Promise<T> {
    if (this.recovering) return this.recovering.then(() => this.raw<T>(method, args));
    return new Promise<T>((resolve, reject) => {
      const flight: Flight = { method, reject };
      if (this.inflight.size === 0) this.lastProgress = Date.now();
      this.inflight.add(flight);
      this.watch();
      this.remote[method](...args).then(
        value => { if (this.inflight.delete(flight)) { this.lastProgress = Date.now(); resolve(value as T); } },
        error => { if (this.inflight.delete(flight)) { this.lastProgress = Date.now(); reject(error); } }
      );
    });
  }

  /** A call that is not followed by the watchdog but has its own time limit (used while recovering). */
  private direct<T>(method: string, args: unknown[], ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Stalled(method)), ms);
      this.remote[method](...args).then(
        value => { clearTimeout(timer); resolve(value as T); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  }

  private watch() {
    if (this.watching || this.closed) return;
    this.watching = true;
    const tick = () => {
      if (this.closed || this.inflight.size === 0) { this.watching = false; return; }
      if (Date.now() - this.lastProgress > this.timeoutMs && !this.recovering) {
        const oldest = [...this.inflight][0];
        this.recovering = this.recover(oldest).finally(() => { this.recovering = undefined; });
      }
      setTimeout(tick, Math.max(20, Math.min(1000, this.timeoutMs / 4)));
    };
    setTimeout(tick, Math.max(20, Math.min(1000, this.timeoutMs / 4)));
  }

  // ------------------------------------------------------------------ recovery

  private async recover(culprit: Flight | undefined) {
    const call = culprit?.method ?? 'unknown';
    // the calls that were waiting fail once the new engine is ready, so whoever catches the error finds a client that works
    const waiting = [...this.inflight];
    this.inflight.clear();

    const accepted: (ScriptRef & { code: string })[] = [];
    try {
      await this.restart([]);
      for (const script of this.scripts.values()) {
        const key = keyOf(script);
        if (this.quarantine.has(key)) continue;
        await this.direct(`set${script.kind[0].toUpperCase()}${script.kind.slice(1)}`, [script.metamodel, script.code], this.probeMs);
        if (await this.probe()) {
          accepted.push(script);
        } else {
          // the engine stopped answering with this script on: leave it off, and start again with the ones that were fine
          this.quarantine.set(key, { kind: script.kind, metamodel: script.metamodel });
          await this.restart(accepted);
        }
      }
    } catch {
      // even the base state would not come back: start from nothing but the grammars, with every script off
      for (const script of this.scripts.values()) this.quarantine.set(keyOf(script), { kind: script.kind, metamodel: script.metamodel });
      await this.restart([]);
    }
    for (const flight of waiting) flight.reject(flight === culprit ? new ScriptTimeoutError(call, this.timeoutMs) : new EngineRestartedError(flight.method));
    const info: RestartInfo = { call, quarantined: [...this.quarantine.values()] };
    for (const listener of [...this.restartListeners]) listener(info);
  }

  /** A new worker, with the grammars, the given scripts, the composition, the instances and the subscriptions put back. */
  private async restart(scripts: (ScriptRef & { code: string })[]) {
    this.stop();
    this.spawn();
    for (const [name, text] of this.grammars) await this.direct('setGrammar', [name, text], this.probeMs);
    for (const script of scripts) await this.direct(`set${script.kind[0].toUpperCase()}${script.kind.slice(1)}`, [script.metamodel, script.code], this.probeMs);
    if (this.selection !== undefined) await this.direct('compose', this.selection ? [this.selection] : [], this.probeMs);
    if (this.texts.size) await this.direct('setInstances', [Object.fromEntries(this.texts)], this.probeMs);
    for (const [listener, entry] of this.listeners) await this.attach(listener, entry, (m, a) => this.direct(m, a, this.probeMs));
  }

  /** Does the engine still answer with everything that is switched on? Runs what scripts run: compose, validate, export, import. */
  private async probe(): Promise<boolean> {
    if (this.selection === undefined) return true;
    const step = async <T,>(method: string, args: unknown[]): Promise<T | undefined> => {
      try { return await this.direct<T>(method, args, this.probeMs); } catch (e) {
        if (e instanceof Stalled) throw e;
        return undefined; // a script that throws is the engine's business, not a hang
      }
    };
    try {
      await step('compose', this.selection ? [this.selection] : []);
      if (this.texts.size) await step('setInstances', [Object.fromEntries(this.texts)]);
      const json = await step<JsonValue>('toProjectJson', []);
      if (json !== undefined) await step('importJson', [json]);
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------------- journal

  private record(method: string, args: unknown[]) {
    if (method === 'setGrammar') this.grammars.set(args[0] as string, args[1] as string);
    else if (method === 'removeGrammar') this.grammars.delete(args[0] as string);
    else if (method in SCRIPT_SETTERS) {
      const ref: ScriptRef = { kind: SCRIPT_SETTERS[method as keyof typeof SCRIPT_SETTERS], metamodel: args[0] as string };
      const code = args[1] as string;
      // sending a script again is a new chance for it
      this.quarantine.delete(keyOf(ref));
      if (code.trim()) this.scripts.set(keyOf(ref), { ...ref, code });
      else this.scripts.delete(keyOf(ref));
    } else if (method === 'compose') this.selection = (args[0] as string[] | undefined) ?? null;
    else if (method === 'setText') this.texts.set(args[0] as string, args[1] as string);
    else if (method === 'setInstances') this.texts = new Map(Object.entries(args[0] as Record<string, string>));
    else if (method === 'removeInstance') this.texts.delete(args[0] as string);
  }

  /** What a result teaches about the instance texts (an edit, an undo, a rename that reached other instances). */
  private learn(method: string, result: unknown) {
    if (['applyEdit', 'createInstance', 'undo', 'redo', 'applyQuickFix', 'setText'].includes(method)) {
      const state = result as InstanceState;
      if (state?.metamodel && state.available) this.texts.set(state.metamodel, state.text);
    } else if (method === 'setInstances') {
      for (const state of result as InstanceState[]) if (state.available) this.texts.set(state.metamodel, state.text);
    } else if (method === 'rename') {
      for (const metamodel of (result as { applied?: string[] }).applied ?? []) {
        void this.raw<InstanceState>('getInstance', [metamodel]).then(state => this.texts.set(metamodel, state.text), () => undefined);
      }
    }
  }

  private invoke(method: string, args: unknown[]) {
    this.record(method, args);
    return this.raw(method, args).then(result => { this.learn(method, result); return result; });
  }

  private async attach(listener: Listener, entry: { unsubscribe?: () => void }, call: (method: string, args: unknown[]) => Promise<unknown>) {
    const unsubscribe = (await call('subscribe', [Comlink.proxy(listener)])) as () => Promise<void>;
    entry.unsubscribe = () => { void unsubscribe(); };
  }

  // --------------------------------------------------------------------- api

  /** The connection: the same async API as a local `Bango`, plus what the watchdog knows. */
  api(methods: readonly string[]) {
    const api: Record<string, unknown> = {};
    for (const method of methods) api[method] = (...args: unknown[]) => this.invoke(method, args);
    api.subscribe = async (listener: Listener): Promise<Unsubscribe> => {
      const entry: { unsubscribe?: () => void } = {};
      this.listeners.set(listener, entry);
      await this.attach(listener, entry, (m, a) => this.raw(m, a));
      return () => { this.listeners.delete(listener); entry.unsubscribe?.(); };
    };
    api.onRestart = (listener: (info: RestartInfo) => void) => {
      this.restartListeners.add(listener);
      return () => { this.restartListeners.delete(listener); };
    };
    api.quarantined = () => [...this.quarantine.values()];
    api.disconnect = () => { this.closed = true; this.stop(); };
    return api;
  }
}
