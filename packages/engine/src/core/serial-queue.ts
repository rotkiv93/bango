/** Runs async work one at a time, in call order: Langium's document builder cannot run two rebuilds of one index at once. */
export class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}
