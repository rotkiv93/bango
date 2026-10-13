interface Pending {
  timer: ReturnType<typeof setTimeout>;
  run(): Promise<void> | void;
}

/**
 * Work that waits a moment after the last request, **per key**: asking again for the same key replaces the earlier request, asking for
 * another key never does. (A single shared timer, as a plain debounce has, silently drops the earlier edit when two different
 * grammars are edited close together.) `flush` runs everything pending right now and waits for all running work.
 */
export class KeyedDebouncer {
  private pending = new Map<string, Pending>();
  private running = new Set<Promise<unknown>>();

  constructor(private onError: (error: unknown) => void = () => {}) {}

  schedule(key: string, ms: number, run: () => Promise<void> | void) {
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    this.pending.set(key, { run, timer: setTimeout(() => this.start(key), ms) });
  }

  private start(key: string) {
    const task = this.pending.get(key);
    if (!task) return;
    clearTimeout(task.timer);
    this.pending.delete(key);
    const promise = Promise.resolve().then(task.run).catch(this.onError).finally(() => this.running.delete(promise));
    this.running.add(promise);
  }

  /** Run everything that is waiting, in the order it was asked, and wait until nothing is running. */
  async flush() {
    for (const key of [...this.pending.keys()]) {
      this.start(key);
      await this.idle();
    }
    await this.idle();
  }

  /** Wait for the work that is running (not for what is still waiting). */
  async idle() {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  get hasPending() {
    return this.pending.size > 0;
  }

  cancel() {
    for (const task of this.pending.values()) clearTimeout(task.timer);
    this.pending.clear();
  }
}
