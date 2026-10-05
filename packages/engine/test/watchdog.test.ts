import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error the adapter ships as a separate ESM file without a package export entry
import nodeEndpoint from '../../../node_modules/comlink/dist/esm/node-adapter.mjs';
import { EngineRestartedError, ScriptTimeoutError, connectBango, type BangoConnection, type RestartInfo } from '@bango/core/client';
import { serveBango } from '../src/worker/index.js';
import { WorkspaceController, workspaceFromSeed } from '../src/workspace/index.js';
import { errors, feedSeed } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

/**
 * A busy loop cannot be run on the thread of a test (it would stop the test too), so the "worker" is a real engine behind a channel
 * that goes silent, for good, the moment it is asked to compose, validate or export while a script marked HANG is switched on. From the
 * client's side that is exactly an engine stuck in a loop: calls that never answer. (The real loop, in a real worker, is run in the
 * browser tests.)
 */
class FakeWorker {
  dead = false;
  terminated = false;
  /** scripts marked HANG that this engine has been given */
  bad = new Set<string>();
  readonly handle: ReturnType<typeof nodeEndpoint> & { terminate(): void };

  constructor() {
    const { port1, port2 } = new MessageChannel();
    const server = nodeEndpoint(port1);
    const listeners = new Map<unknown, unknown>();
    serveBango({
      postMessage: (...args: unknown[]) => { if (!this.dead) server.postMessage(...args); },
      addEventListener: (type: string, handler: (event: { data: unknown }) => void, ...rest: unknown[]) => {
        const wrapped = (event: { data: unknown }) => { if (!this.dead && !this.inspect(event.data as never)) handler(event); };
        listeners.set(handler, wrapped);
        server.addEventListener(type, wrapped, ...rest);
      },
      removeEventListener: (type: string, handler: unknown, ...rest: unknown[]) => server.removeEventListener(type, listeners.get(handler) ?? handler, ...rest),
      start: () => server.start?.()
    } as never);
    this.handle = Object.assign(nodeEndpoint(port2), { terminate: () => { this.terminated = true; port1.close(); port2.close(); } });
  }

  /** true when the message is swallowed: the engine is stuck */
  private inspect(message: { type?: string; path?: string[]; argumentList?: { value?: unknown }[] }): boolean {
    const method = message?.path?.[0];
    const args = (message?.argumentList ?? []).map(a => a.value);
    if (method && /^set(Constraints|Spec|Import|Scope)$/.test(method)) {
      const key = `${method}:${args[0]}`;
      if (String(args[1]).includes('HANG')) this.bad.add(key); else this.bad.delete(key);
    }
    if (method && ['compose', 'setInstances', 'setText', 'toProjectJson', 'importJson'].includes(method) && this.bad.size) {
      this.dead = true;
      return true;
    }
    return false;
  }
}

const open: BangoConnection[] = [];
afterEach(() => { for (const c of open.splice(0)) c.disconnect(); });

/** Short enough to keep the tests quick, long enough for a cold compose of the examples on a slow machine. */
const TIMEOUT = 1500;

function connect(options: { timeoutMs?: number } = {}) {
  const workers: FakeWorker[] = [];
  const restarts: RestartInfo[] = [];
  const client = connectBango(() => { const w = new FakeWorker(); workers.push(w); return w.handle; }, { timeoutMs: TIMEOUT, probeTimeoutMs: TIMEOUT, onRestart: r => restarts.push(r), ...options });
  open.push(client);
  return { client, workers, restarts };
}

/** The city project, with every shipped script, loaded through the client. */
async function loadCity(client: BangoConnection) {
  const seed = loadSeed();
  await feedSeed(client, seed);
  await client.compose(seed.projects.city.metamodels);
  await client.setInstances(seed.projects.city.instances);
  return seed;
}

describe('a connection made from a function that makes the worker', () => {
  it('behaves like any connection while the engine answers, and does not restart it', async () => {
    const { client, workers, restarts } = connect();
    await loadCity(client);
    expect(errors((await client.getInstance('gismodel')).problems)).toEqual([]);
    expect((await client.build('city')).ok).toBe(true);
    expect(workers).toHaveLength(1);
    expect(restarts).toEqual([]);
    expect(client.quarantined()).toEqual([]);
    // many calls close together, all answered
    const all = await Promise.all(Array.from({ length: 30 }, () => client.getInstances()));
    expect(all.every(a => a.length === 2)).toBe(true);
  });

  it('a script that makes the engine stop answering: the call fails, the engine is replaced, the script is switched off, the rest is back', async () => {
    const { client, workers, restarts } = connect();
    const seed = await loadCity(client);
    const before = await client.getInstances();

    await client.setConstraints('datamodel', 'while (true) {} // HANG\nreturn {};');
    const failure = await client.compose(seed.projects.city.metamodels).catch(e => e);
    expect(failure).toBeInstanceOf(ScriptTimeoutError);
    expect((failure as ScriptTimeoutError).call).toBe('compose');
    expect((failure as Error).message).toMatch(/did not finish in 1\.5 s/);

    // a new worker, the old one terminated, and exactly the culprit switched off
    // one worker started clean, one more once the culprit was found (and the ones that were fine put back); every old one terminated
    expect(workers).toHaveLength(3);
    expect(workers.slice(0, 2).every(w => w.terminated)).toBe(true);
    expect(workers[2].terminated).toBe(false);
    expect(restarts).toEqual([{ call: 'compose', quarantined: [{ kind: 'constraints', metamodel: 'datamodel' }] }]);
    expect(client.quarantined()).toEqual([{ kind: 'constraints', metamodel: 'datamodel' }]);

    // everything that was loaded is where it was
    const after = await client.getInstances();
    expect(after.map(i => [i.metamodel, i.text])).toEqual(before.map(i => [i.metamodel, i.text]));
    expect((await client.getComposition())!.selection).toEqual(['datamodel', 'gismodel']);
    for (const s of after) expect(errors(s.problems), s.metamodel).toEqual([]);
    // the other scripts are on (the GIS model's rule about styles) and the culprit is off (the data model's rule about duplicates)
    const gis = seed.projects.city.instances.gismodel.replace('availableStyles thin', 'availableStyles thin2').replace('geojsonstyle thin', 'geojsonstyle thin2 fillColor "#fff" strokeColor "#000" fillOpacity 0.5 strokeOpacity 1.0 radius 2.0\ngeojsonstyle thin');
    expect(errors((await client.setText('gismodel', gis)).problems).join()).toMatch(/defaultStyle 'thin' must be one of availableStyles/);
    const dup = seed.projects.city.instances.datamodel.replace('property lanes: Integer', 'property name: String');
    expect(errors((await client.setText('datamodel', dup)).problems).join()).not.toMatch(/duplicate field/);
  });

  it('a scope script that loops while a reference is resolved is switched off too, and the reference falls back to the default scope', async () => {
    const { client, restarts } = connect();
    const seed = await loadCity(client);
    await client.setScope('gismodel', 'return { GeoJsonLayer: { entity() { while (true) {} } } }; // HANG');
    const failure = await client.compose(seed.projects.city.metamodels).catch(e => e);
    expect(failure).toBeInstanceOf(ScriptTimeoutError);
    expect(restarts).toEqual([{ call: 'compose', quarantined: [{ kind: 'scope', metamodel: 'gismodel' }] }]);
    expect(client.quarantined()).toEqual([{ kind: 'scope', metamodel: 'gismodel' }]);
    // the engine is back, with its instances, and the entity of the layer resolves the ordinary way
    for (const s of await client.getInstances()) expect(errors(s.problems), s.metamodel).toEqual([]);
    expect((await client.getInstance('gismodel')).ast).toBeDefined();
  });

  it('sending the script again, fixed, takes it out of quarantine, and its rules apply again', async () => {
    const { client, restarts } = connect();
    const seed = await loadCity(client);
    await client.setConstraints('datamodel', 'while (true) {} // HANG\nreturn {};');
    await client.compose(seed.projects.city.metamodels).catch(() => undefined);
    expect(client.quarantined()).toHaveLength(1);

    await client.setConstraints('datamodel', seed.constraints.datamodel);
    expect(client.quarantined()).toEqual([]);
    await client.compose(seed.projects.city.metamodels);
    const dup = seed.projects.city.instances.datamodel.replace('property lanes: Integer', 'property name: String');
    expect(errors((await client.setText('datamodel', dup)).problems).join()).toMatch(/duplicate field 'name'/);
    expect(restarts).toHaveLength(1);
  });

  it('calls that were waiting behind the stuck one are cancelled with a reason, and can be asked again', async () => {
    const { client } = connect();
    const seed = await loadCity(client);
    await client.setSpec('datamodel', 'while (true) {} // HANG\nreturn function () { return {}; };');
    const results = await Promise.allSettled([
      client.toProjectJson(),
      client.getInstances(),
      client.getComposition(),
      client.getInstance('gismodel')
    ]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect((results[0] as PromiseRejectedResult).reason).toBeInstanceOf(ScriptTimeoutError);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(EngineRestartedError);
    expect(((results[1] as PromiseRejectedResult).reason as EngineRestartedError).call).toBe('getInstances');
    // asking again works, on the new engine, with the same instances
    expect((await client.getInstances()).map(i => i.text)).toEqual([seed.projects.city.instances.datamodel, seed.projects.city.instances.gismodel]);
    expect(client.quarantined()).toEqual([{ kind: 'spec', metamodel: 'datamodel' }]);
  });

  it('only the scripts that make the engine stop are switched off, one at a time, whatever their kind', async () => {
    const { client, workers } = connect();
    const seed = await loadCity(client);
    await client.setConstraints('gismodel', 'while (true) {} // HANG\nreturn {};');
    await client.setSpec('datamodel', 'while (true) {} // HANG\nreturn function () { return {}; };');
    await client.setImport('datamodel', "return function (json, { n }) { return n('Model', {}); };");
    await client.compose(seed.projects.city.metamodels).catch(() => undefined);
    expect([...client.quarantined()].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'constraints', metamodel: 'gismodel' },
      { kind: 'spec', metamodel: 'datamodel' }
    ]);
    expect(workers.length).toBeGreaterThanOrEqual(3);
    // the good script (the import mapping) and the other constraints are on
    const info = await client.compose(seed.projects.city.metamodels);
    expect(info.languages.find(l => l.name === 'datamodel')!.canImport).toBe(true);
    expect(errors((await client.getInstance('datamodel')).problems)).toEqual([]);
  });

  it('events keep coming from the new engine', async () => {
    const { client } = connect();
    const seed = await loadCity(client);
    const seen: string[] = [];
    await client.subscribe(e => seen.push(e.type));
    await client.setConstraints('datamodel', 'while (true) {} // HANG\nreturn {};');
    await client.compose(seed.projects.city.metamodels).catch(() => undefined);
    seen.length = 0;
    await client.setText('datamodel', seed.projects.city.instances.datamodel + '\n');
    await new Promise(r => setTimeout(r, 50));
    expect(seen).toContain('instance');
  });

  it('the texts changed through edits, undo and a rename are what comes back, not the ones set first', async () => {
    const { client } = connect();
    const seed = await loadCity(client);
    const edited = await client.applyEdit('datamodel', { kind: 'set', path: [{ feature: 'entities', index: 0 }], feature: 'name', value: 'Street' });
    expect(edited.text).toContain('entity Street');
    await client.setConstraints('datamodel', 'while (true) {} // HANG\nreturn {};');
    await client.compose(seed.projects.city.metamodels).catch(() => undefined);
    expect((await client.getInstance('datamodel')).text).toBe(edited.text);
    // and an undo before the restart is remembered too (the history itself is lost, the text is not)
    await client.setConstraints('datamodel', seed.constraints.datamodel);
    await client.compose(seed.projects.city.metamodels);
    const undone = await client.undo('datamodel');
    expect(undone.text).toBe(edited.text);
  });

  it('a call that takes long but makes progress is not mistaken for a stuck engine', async () => {
    const { client, workers, restarts } = connect({ timeoutMs: 3000 });
    const seed = await loadCity(client);
    const started = Date.now();
    // sequential calls that each finish: the clock restarts every time one does
    for (let i = 0; i < 12; i++) await client.setText('datamodel', seed.projects.city.instances.datamodel + '\n'.repeat(i));
    expect(Date.now() - started).toBeGreaterThan(0);
    expect(workers).toHaveLength(1);
    expect(restarts).toEqual([]);
  });

  it('disconnecting stops the worker and the watching', async () => {
    const { client, workers } = connect();
    await loadCity(client);
    client.disconnect();
    expect(workers[0].terminated).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(workers).toHaveLength(1);
  });

  it('a connection made from the worker itself is a plain one: nothing to restart, nothing quarantined', async () => {
    const { port1, port2 } = new MessageChannel();
    serveBango(nodeEndpoint(port1));
    const plain = connectBango(nodeEndpoint(port2));
    expect(plain.quarantined()).toEqual([]);
    expect(typeof plain.onRestart(() => undefined)).toBe('function');
    await plain.setGrammar('x', 'grammar X\nentry E: "e";');
    plain.disconnect();
    port1.close();
    port2.close();
  });
});

describe('the workspace controller on an engine that can be restarted', () => {
  it('shows the script that was switched off, reads everything again, and forgets the warning once the script is edited', async () => {
    const { client } = connect();
    const seed = loadSeed();
    const controller = new WorkspaceController(client, { seed: () => workspaceFromSeed(seed), delays: { push: 10, refresh: 10, persist: 10 }, onError: () => undefined });
    await controller.init();
    await controller.openProject('city');
    expect(controller.state.quarantined).toEqual([]);

    // an edit of a script, sent a moment later: the engine stops answering, is replaced, and the culprit is known
    controller.editScript('constraints', 'datamodel', 'while (true) {} // HANG\nreturn {};');
    await controller.flush();
    await expect.poll(() => controller.state.quarantined, { timeout: 20_000 }).toEqual([{ kind: 'constraints', metamodel: 'datamodel' }]);
    // the project is there, on the new engine
    await expect.poll(() => controller.state.instances.map(i => i.metamodel).sort()).toEqual(['datamodel', 'gismodel']);
    for (const i of controller.state.instances) expect(errors(i.problems), i.metamodel).toEqual([]);

    // editing it takes it off the list, and the engine gets it again
    controller.editScript('constraints', 'datamodel', seed.constraints.datamodel);
    expect(controller.state.quarantined).toEqual([]);
    await controller.flush();
    const dup = seed.projects.city.instances.datamodel.replace('property lanes: Integer', 'property name: String');
    await client.setText('datamodel', dup);
    await controller.flush();
    expect(errors(controller.state.instances.find(i => i.metamodel === 'datamodel')!.problems).join()).toMatch(/duplicate field/);
    controller.dispose();
  }, 60_000);

  it('switching a script back on sends it again, as it is', async () => {
    const { client } = connect();
    const seed = loadSeed();
    const controller = new WorkspaceController(client, { seed: () => workspaceFromSeed(seed), delays: { push: 10, refresh: 10, persist: 10 }, onError: () => undefined });
    await controller.init();
    await controller.openProject('city');
    controller.editScript('constraints', 'datamodel', 'while (true) {} // HANG\nreturn {};');
    await controller.flush();
    await expect.poll(() => controller.state.quarantined.length, { timeout: 20_000 }).toBe(1);
    controller.reenableScript('constraints', 'datamodel');
    expect(controller.state.quarantined).toEqual([]);
    // it is the same script, so the engine stops again and it is switched off again
    await controller.flush();
    await expect.poll(() => controller.state.quarantined.length, { timeout: 30_000 }).toBe(1);
    controller.dispose();
  }, 90_000);
});
