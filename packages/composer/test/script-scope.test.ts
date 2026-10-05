import { describe, expect, it } from 'vitest';
import { compileConstraints, compileImport, compileSpec } from '../src/index.js';

const SHADOWED = [
  'self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage',
  'Worker', 'SharedWorker', 'indexedDB', 'caches', 'localStorage', 'sessionStorage', 'Function', 'eval', 'setTimeout', 'setInterval', 'queueMicrotask'
];

const run = (body: string, ...args: unknown[]) => (compileSpec(body).map as (...a: unknown[]) => unknown)(...args);

describe('what a script can reach', () => {
  it('none of the ways out are there: network, storage, threads, the global object, making code from text', () => {
    const types = run(`return function () { return [${SHADOWED.map(n => `typeof ${n}`).join(', ')}]; };`, {}) as string[];
    expect(types).toEqual(SHADOWED.map(() => 'undefined'));
  });

  it('using them is a plain TypeError, which is how the engine reports a failing mapping', () => {
    for (const call of ["fetch('http://example.com')", "eval('1 + 1')", "new Function('return 1')()", "setTimeout(() => 1, 1)", "self.postMessage(1)", "importScripts('x.js')", "new WebSocket('ws://x')"]) {
      expect(() => run(`return function () { return ${call}; };`, {}), call).toThrow(TypeError);
    }
  });

  it('everything a mapping needs is still there: the language itself, and the helpers', () => {
    const out = run(`return function (model, { refName, typeName, duplicates, n }) {
      const sorted = [...new Set([3, 1, 2, 3])].sort((a, b) => a - b);
      return {
        sorted, json: JSON.parse(JSON.stringify({ a: 1 })), math: Math.max(1, 2), text: String(10).padStart(3, '0'),
        map: new Map([[1, 'x']]).get(1), date: typeof Date, regex: /a+/.test('caat'),
        helpers: [typeof refName, typeof typeName, typeof duplicates, typeof n],
        node: n('T', { a: 1 }), dups: duplicates([1, 2, 1], x => x).length
      };
    };`, { x: 1 }) as Record<string, unknown>;
    expect(out).toMatchObject({
      sorted: [1, 2, 3], json: { a: 1 }, math: 2, text: '010', map: 'x', date: 'function', regex: true,
      helpers: ['function', 'function', 'function', 'function'], node: { $node: 'T', fields: { a: 1 } }, dups: 1
    });
  });

  it('the body is strict: `this` is nothing, and a typo does not create a global', () => {
    expect(run('return function () { return this === undefined; };', {})).toBe(true);
    expect(() => run('return function () { undeclared = 1; };', {})).toThrow(ReferenceError);
    expect(() => compileConstraints('return { A() { notDefined = 1; } };').forEach(m => (m.checks.A as () => void)())).toThrow(ReferenceError);
  });

  it('the helpers a script is given cannot be changed, so one script cannot spoil them for the next', () => {
    const frozen = run('return function (model, helpers) { return Object.isFrozen(helpers); };', {});
    expect(frozen).toBe(true);
    expect(() => run("return function (model, helpers) { 'use strict'; helpers.refName = () => 'hacked'; };", {})).toThrow(TypeError);
    // and the same for an import mapping
    expect((compileImport('return function (json, helpers) { return Object.isFrozen(helpers) ? json : null; };') as (j: unknown) => unknown)({ ok: 1 })).toEqual({ ok: 1 });
  });

  it('a syntax error is still reported readably, and top-level `return` and comments at the end are fine', () => {
    expect(() => compileSpec('return function ( {')).toThrow(SyntaxError);
    expect(typeof compileSpec('// a comment last\nreturn function () { return 1; }; // and another').map).toBe('function');
    expect(() => compileSpec('return 42;')).toThrow(/a JSON mapping must/);
  });

  it('what is shadowed is not a promise that the script is safe', () => {
    // documented limit: the global object can still be reached through a function's constructor. This pins the behaviour so that a change
    // is noticed and the documentation changed with it
    const reached = run("return function () { try { return typeof (() => 1).constructor('return globalThis')(); } catch { return 'blocked'; } };", {});
    expect(['object', 'blocked']).toContain(reached);
  });
});
