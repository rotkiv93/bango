// Packs every library package, installs the tarballs into an empty project and uses them the way a consumer would.
// This is what finds a wrong `exports` entry, a missing file in `files`, or a dependency that is only there because of the workspace.
// Run after `npm run build:libs`:  node scripts/pack-smoke.mjs
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packages = ['core', 'composer', 'engine', 'renderer'];
const work = mkdtempSync(join(tmpdir(), 'bango-pack-'));
const run = (command, cwd) => execSync(command, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

/** Entry points that need a browser (a DOM, a worker global, Monaco): checked for their files, not imported in Node. */
const browserOnly = new Set(['@bango/renderer', '@bango/renderer/text', '@bango/renderer/bundle', '@bango/engine/bundle/worker']);

let failed = 0;
const fail = message => { failed++; console.error(`FAIL ${message}`); };

try {
  // 1. pack
  const tarballs = {};
  for (const name of packages) {
    const dir = join(root, 'packages', name);
    if (!existsSync(join(dir, 'dist'))) throw new Error(`packages/${name}/dist is missing: run \`npm run build:libs\` first`);
    const out = run(`npm pack --silent --pack-destination "${work}"`, dir).trim().split('\n').at(-1);
    tarballs[`@bango/${name}`] = join(work, out);
    console.log(`packed @bango/${name}: ${out}`);
  }

  // 2. install them, and only them, into a clean project (the other tarballs stand in for the registry)
  const project = join(work, 'consumer');
  mkdirSync(project);
  const overrides = Object.fromEntries(Object.entries(tarballs).map(([n, t]) => [n, `file:${t.replaceAll('\\', '/')}`]));
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'consumer', private: true, type: 'module',
    dependencies: { ...overrides, langium: '^4.4.0', comlink: '^4.4.2' },
    overrides
  }, null, 2));
  run('npm install --no-audit --no-fund --loglevel=error', project);

  // 3. every entry point of every package: its files exist, and the ones that run in Node import
  for (const name of packages) {
    const pkgDir = join(project, 'node_modules', '@bango', name);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      const spec = `@bango/${name}${subpath.slice(1)}`;
      const files = typeof target === 'string' ? [target] : Object.values(target);
      for (const file of files) if (!existsSync(join(pkgDir, file))) fail(`${spec}: ${file} is not in the package`);
      if (!browserOnly.has(spec)) writeFileSync(join(project, `check-${name}-${subpath.replace(/\W/g, '_')}.mjs`), `import * as m from '${spec}';\nif (!Object.keys(m).length) throw new Error('${spec} exports nothing');\nconsole.log('imported ${spec}', Object.keys(m).length, 'exports');\n`);
    }
  }
  for (const file of run('node -e "console.log(require(\'fs\').readdirSync(\'.\').filter(f => f.startsWith(\'check-\')).join(\'\\n\'))"', project).trim().split('\n').filter(Boolean)) {
    try { process.stdout.write(run(`node ${file}`, project)); } catch { fail(`${file} could not be imported`); }
  }

  // 4. the library used as a consumer would: compose, edit, build
  writeFileSync(join(project, 'use.mjs'), `
    import { Bango } from '@bango/engine';
    import { WorkspaceController, MemoryStorage } from '@bango/engine/workspace';
    import { toJsonSpec } from '@bango/core';
    const bango = new Bango();
    await bango.setGrammar('common', "grammar Common\\nterminal ID: /[_a-zA-Z][\\\\w_-]*/;\\nhidden terminal WS: /\\\\s+/;\\n");
    await bango.setGrammar('things', "grammar Things\\nimport 'common'\\n// Things: a list of named things\\nentry Model: 'things' (items+=Item)*;\\nItem: 'item' name=ID;\\n");
    const info = await bango.compose(['things']);
    if (info.languages.length !== 1) throw new Error('did not compose');
    const state = await bango.setText('things', 'things\\nitem a\\nitem b\\n');
    if (state.problems.length) throw new Error('unexpected problems ' + JSON.stringify(state.problems));
    const edited = await bango.applyEdit('things', { kind: 'add', path: [], feature: 'items', type: 'Item' });
    if (!edited.text.includes('newItem')) throw new Error('edit did not apply');
    const build = await bango.build('smoke');
    if (!build.ok) throw new Error('build failed ' + build.errors.join());
    if (!toJsonSpec(build.model.instances[0].ast).items) throw new Error('no json');
    const controller = new WorkspaceController(bango, { storage: new MemoryStorage() });
    await controller.init();
    console.log('the packed libraries compose, edit, build and keep a workspace');
  `);
  try { process.stdout.write(run('node use.mjs', project)); } catch { fail('use.mjs failed: the packed libraries do not work together'); }

  // 5. the types a consumer sees: a TypeScript file that uses the packed declarations (the repository's own tsc, the project's own tsconfig)
  writeFileSync(join(project, 'use.ts'), `
    import { Bango, type InstanceState } from '@bango/engine';
    import { WorkspaceController, MemoryStorage, type WorkspaceState } from '@bango/engine/workspace';
    import { connectBango } from '@bango/core/client';
    import { ModelComposer, type Composition } from '@bango/composer';
    import type { EditOp, Problem, BangoApi } from '@bango/core';
    const op: EditOp = { kind: 'set', path: [], feature: 'name', value: 'x' };
    const bango: BangoApi = new Bango();
    const controller = new WorkspaceController(bango, { storage: new MemoryStorage() });
    const state: WorkspaceState = controller.state;
    const states: Promise<InstanceState[]> = bango.getInstances();
    const composer = new ModelComposer();
    const composition: Promise<Composition> = composer.compose(['a']);
    const problems: Problem[] = state.instances.flatMap(i => i.problems);
    void [op, states, composition, problems, connectBango];
  `);
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['ES2022', 'DOM', 'WebWorker'] },
    include: ['use.ts']
  }));
  try { run(`node "${join(root, 'node_modules', 'typescript', 'bin', 'tsc')}" -p .`, project); console.log('the packed type declarations check'); } catch { fail('the packed type declarations do not check in a consumer project'); }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log('pack smoke: ok');
