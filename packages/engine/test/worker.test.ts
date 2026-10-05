import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
// @ts-expect-error the adapter ships as a separate ESM file without a package export entry
import nodeEndpoint from '../../../node_modules/comlink/dist/esm/node-adapter.mjs';
import type { EngineEvent } from '../src/index.js';
import { connectBango } from '@bango/core/client';
import { serveBango } from '../src/worker/index.js';
import { errors } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

/**
 * Runs the real `serveBango` / `connectBango` pair over a MessageChannel, so every call and result goes through
 * structured clone exactly as it does with a Web Worker (the worker just lives on this thread).
 */
function connect() {
  const { port1, port2 } = new MessageChannel();
  serveBango(nodeEndpoint(port1));
  const client = connectBango(nodeEndpoint(port2));
  return { client, close: () => { client.disconnect(); port1.close(); port2.close(); } };
}

describe('worker boundary', () => {
  it('composes, edits and builds through the same async API', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    const city = seed.projects.city;
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    for (const [n, c] of Object.entries(seed.constraints)) await client.setConstraints(n, c);

    const info = await client.compose(city.metamodels);
    expect(info.problems).toEqual([]);
    expect(info.languages.map(l => l.name)).toEqual(['datamodel', 'gismodel']);

    for (const [m, t] of Object.entries(city.instances)) await client.setText(m, t);
    const state = await client.getInstance('gismodel');
    expect(errors(state.problems)).toEqual([]);
    expect(state.ast!.type).toBe('Gis');

    const edited = await client.applyEdit('gismodel', { kind: 'add', path: [], feature: 'layers', type: 'TileLayer' });
    expect(edited.text).toContain('tilelayer newTileLayer');

    expect((await client.getRefCandidates('Entity')).map(c => c.name)).toContain('Road');
    expect((await client.build('city')).ok).toBe(true);
    expect(await client.bundleText('gismodel')).toMatch(/^grammar GisModel/);

    // editor requests carry the live text, which the engine adopts as the instance text
    const live = 'gismodel\ngeojsonlayer r entity ';
    expect((await client.complete('gismodel', live, 1, 'geojsonlayer r entity '.length)).map(i => i.label)).toContain('Road');
    expect((await client.getInstance('gismodel')).text).toBe(live);
    close();
  });

  it('typings and metamodel cases cross the boundary', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    for (const [n, c] of Object.entries(seed.constraints)) await client.setConstraints(n, c);
    expect(await client.getTypings('datamodel')).toContain('interface Entity extends AstNode');
    const results = await client.runCases('datamodel', seed.cases.datamodel);
    expect(results.map(r => r.ok)).toEqual(seed.cases.datamodel.map(() => true));
    close();
  });

  it('imports a project from its JSON through the boundary', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    for (const [n, c] of Object.entries(seed.specs)) await client.setSpec(n, c);
    for (const [n, c] of Object.entries(seed.imports)) await client.setImport(n, c);
    await client.compose(seed.projects.gresint.metamodels);
    const result = await client.importJson(seed.expected.gresint as never);
    expect(result.errors).toEqual([]);
    await client.setInstances(result.texts);
    expect(await client.toProjectJson()).toEqual(seed.expected.gresint);
    close();
  });

  it('delivers events to a callback across the boundary and stops after unsubscribe', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    await client.compose(['datamodel']);

    const seen: EngineEvent[] = [];
    const off = await client.subscribe(e => seen.push(e));
    await client.setText('datamodel', 'datamodel a');
    await new Promise(r => setTimeout(r, 50));
    expect(seen).toEqual([{ type: 'instance', metamodel: 'datamodel' }]);

    off();
    await new Promise(r => setTimeout(r, 50));
    await client.setText('datamodel', 'datamodel b');
    await new Promise(r => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    close();
  });

  it('errors thrown inside the worker reject on the caller side with their message', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    await client.compose(['datamodel']);
    await client.setText('datamodel', 'datamodel a\nentity A {\n property x: String pk\n}');
    await expect(client.applyEdit('datamodel', { kind: 'remove', path: [] })).rejects.toThrow(/root/);
    close();
  });

  it('returns only plain data (nothing Langium leaks across)', async () => {
    const { client, close } = connect();
    const seed = loadSeed();
    for (const [n, t] of Object.entries(seed.grammars)) await client.setGrammar(n, t);
    const info = await client.compose();
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
    close();
  });
});
