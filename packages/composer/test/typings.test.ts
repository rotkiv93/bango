import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composerWith } from '../../../test-support/harness.js';

const tsc = join(import.meta.dirname, '../../../node_modules/typescript/bin/tsc');

/**
 * Type-checks a script against the typings, the way the editor does: the script is a function body (it `return`s), so it is
 * wrapped in a function here. Returns tsc's complaints.
 */
function check(typings: string, script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bango-typings-'));
  try {
    writeFileSync(join(dir, 'typings.d.ts'), typings);
    writeFileSync(join(dir, 'script.js'), `// @ts-check\nfunction body() {\n${script}\n}\n`);
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '--allowJs', '--checkJs', '--strictNullChecks', '--noImplicitAny', 'false', '--target', 'es2022', '--lib', 'es2022', '--types', '', join(dir, 'typings.d.ts'), join(dir, 'script.js')], { encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? e);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('typings for scripts', () => {
  it('declares the AST types of a metamodel with their properties', async () => {
    const { composer } = composerWith();
    const dts = await composer.typings('datamodel');
    expect(dts).toContain('interface Entity extends AstNode');
    expect(dts).toMatch(/readonly fields: .*\[\];/);
    expect(dts).toMatch(/readonly name: string;/);
    expect(dts).toContain('interface Constraints');
    // the type of the entry rule is what a JSON mapping receives
    expect(dts).toMatch(/type Spec = \(\(model: Model,/);
  });

  it('a metamodel that imports another includes its types, and references are typed', async () => {
    const { composer } = composerWith();
    const dts = await composer.typings('gismodel');
    expect(dts).toContain('interface Entity extends AstNode');
    expect(dts).toMatch(/Ref<Entity>/);
  });

  it('a grammar that does not exist, or is broken, still gets the helpers', async () => {
    const { composer } = composerWith({ broken: 'grammar Broken\nentry X: nonsense' });
    for (const name of ['nope', 'broken']) {
      const dts = await composer.typings(name);
      expect(dts).toContain('declare const refName');
      expect(dts).toContain('interface Constraints');
    }
  });

  it('every shipped constraint file, JSON mapping and import mapping type-checks against the typings of its metamodel', async () => {
    const { composer, seed } = composerWith();
    for (const [name, code] of Object.entries(seed.constraints)) {
      expect(check(await composer.typings(name), code), `${name}.constraints.js`).toBe('');
    }
    for (const [name, code] of Object.entries(seed.specs)) {
      expect(check(await composer.typings(name), code), `${name}.spec.js`).toBe('');
    }
    for (const [name, code] of Object.entries(seed.imports)) {
      expect(check(await composer.typings(name), code), `${name}.import.js`).toBe('');
    }
  }, 120_000);

  it('a misspelled property is an error, and a typed node completes to the right shape', async () => {
    const { composer } = composerWith();
    const dts = await composer.typings('datamodel');
    const bad = check(dts, `/** @type {Constraints} */\nconst c = { Entity(entity, accept) { entity.feilds.length; } };\nreturn c;`);
    expect(bad).toMatch(/Property 'feilds' does not exist on type 'Entity'/);
    const wrongType = check(dts, `/** @type {Constraints} */\nconst c = { Entity(entity, accept) { accept('fatal', 'x', { node: entity }); } };\nreturn c;`);
    expect(wrongType).toMatch(/fatal/);
    const unknownRule = check(dts, `/** @type {Constraints} */\nconst c = { Entiti(entity, accept) {} };\nreturn c;`);
    expect(unknownRule).toMatch(/Entiti/);
  }, 120_000);
});
