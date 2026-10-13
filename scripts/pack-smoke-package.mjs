// Packs @lbdudc/bango (the one package that is published), installs the tarball alone into an empty project and uses it the way a
// consumer would. Run after `npm run build`:  node scripts/pack-smoke-package.mjs
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'packages', 'bango');
const work = mkdtempSync(join(tmpdir(), 'bango-package-'));
const run = (command, cwd) => execSync(command, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const slashes = path => path.split(/[\\/]/).join('/');

/** Entry points that need a browser (a DOM, a worker global, Monaco): checked for their files, not imported in Node. */
const browserOnly = new Set(['@lbdudc/bango/renderer', '@lbdudc/bango/renderer/text', '@lbdudc/bango/renderer/bundle', '@lbdudc/bango/studio/bundle', '@lbdudc/bango/engine/bundle/worker']);

let failed = 0;
const fail = message => { failed++; console.error(`FAIL ${message}`); };

// the consumer's program: a metamodel with its grammar given as lines joined by real newlines
const grammarCommon = ['grammar Common', 'terminal ID: /[_a-zA-Z][\\w_-]*/;', 'hidden terminal WS: /\\s+/;', ''].join('\n');
const grammarThings = ['grammar Things', "import 'common'", '// Things: a list of named things', "entry Model: 'things' (items+=Item)*;", "Item: 'item' name=ID;", ''].join('\n');

try {
  if (!existsSync(join(dir, 'dist'))) throw new Error('packages/bango/dist is missing: run `npm run build` first');
  const tarball = join(work, run(`npm pack --silent --pack-destination "${work}"`, dir).trim().split('\n').at(-1));
  console.log(`packed @lbdudc/bango: ${tarball.split(/[\\/]/).at(-1)}`);

  const project = join(work, 'consumer');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'consumer', private: true, type: 'module',
    dependencies: { '@lbdudc/bango': `file:${slashes(tarball)}`, langium: '^4.4.0' }
  }, null, 2));
  run('npm install --no-audit --no-fund --loglevel=error', project);
  const pkgDir = join(project, 'node_modules', '@lbdudc', 'bango');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

  // 1. nothing published may name a package that is not on the registry
  const stray = [];
  const walk = d => {
    for (const entry of readdirSync(d)) {
      const file = join(d, entry);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(js|mjs|d\.ts)$/.test(entry) && /["']@bango\//.test(readFileSync(file, 'utf8'))) stray.push(slashes(file.slice(pkgDir.length + 1)));
    }
  };
  walk(join(pkgDir, 'dist'));
  if (stray.length) fail(`still import @bango/*: ${stray.slice(0, 5).join(', ')}`);

  // 2. every entry point: its files exist, and the ones that run in Node import
  const checks = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === './package.json') continue;
    const spec = `@lbdudc/bango${subpath.slice(1)}`;
    for (const file of typeof target === 'string' ? [target] : Object.values(target)) if (!existsSync(join(pkgDir, file))) fail(`${spec}: ${file} is not in the package`);
    if (!browserOnly.has(spec)) {
      const file = `check-${checks.length}.mjs`;
      writeFileSync(join(project, file), `import * as m from '${spec}';\nif (!Object.keys(m).length) throw new Error('${spec} exports nothing');\nconsole.log('imported ${spec}', Object.keys(m).length, 'exports');\n`);
      checks.push(file);
    }
  }
  for (const file of checks) {
    try { process.stdout.write(run(`node ${file}`, project)); } catch { fail(`${file} could not be imported`); }
  }

  // 3. used as a consumer would: compose, edit, build
  writeFileSync(join(project, 'use.mjs'), [
    "import { Bango } from '@lbdudc/bango';",
    "import { WorkspaceController, MemoryStorage } from '@lbdudc/bango/engine/workspace';",
    "import { toJsonSpec } from '@lbdudc/bango/core';",
    'const bango = new Bango();',
    `await bango.setGrammar('common', ${JSON.stringify(grammarCommon)});`,
    `await bango.setGrammar('things', ${JSON.stringify(grammarThings)});`,
    "const info = await bango.compose(['things']);",
    "if (info.languages.length !== 1) throw new Error('did not compose');",
    "const state = await bango.setText('things', 'things\\nitem a\\nitem b\\n');",
    "if (state.problems.length) throw new Error('unexpected problems ' + JSON.stringify(state.problems));",
    "const edited = await bango.applyEdit('things', { kind: 'add', path: [], feature: 'items', type: 'Item' });",
    "if (!edited.text.includes('newItem')) throw new Error('edit did not apply');",
    "const build = await bango.build('smoke');",
    "if (!build.ok) throw new Error('build failed ' + build.errors.join());",
    "if (!toJsonSpec(build.model.instances[0].ast).items) throw new Error('no json');",
    'const controller = new WorkspaceController(bango, { storage: new MemoryStorage() });',
    'await controller.init();',
    "console.log('@lbdudc/bango composes, edits, builds and keeps a workspace');",
    ''
  ].join('\n'));
  try { process.stdout.write(run('node use.mjs', project)); } catch { fail('use.mjs failed: the packed library does not work'); }

  // 4. the types a consumer sees
  writeFileSync(join(project, 'use.ts'), [
    "import { Bango, type InstanceState } from '@lbdudc/bango';",
    "import { WorkspaceController, MemoryStorage, type WorkspaceState } from '@lbdudc/bango/engine/workspace';",
    "import { connectBango } from '@lbdudc/bango/core/client';",
    "import { ModelComposer, type Composition } from '@lbdudc/bango/composer';",
    "import type { EditOp, Problem, BangoApi } from '@lbdudc/bango/core';",
    "const op: EditOp = { kind: 'set', path: [], feature: 'name', value: 'x' };",
    'const bango: BangoApi = new Bango();',
    'const controller = new WorkspaceController(bango, { storage: new MemoryStorage() });',
    'const state: WorkspaceState = controller.state;',
    'const states: Promise<InstanceState[]> = bango.getInstances();',
    'const composer = new ModelComposer();',
    "const composition: Promise<Composition> = composer.compose(['a']);",
    'const problems: Problem[] = state.instances.flatMap(i => i.problems);',
    'void [op, states, composition, problems, connectBango];',
    ''
  ].join('\n'));
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['ES2022', 'DOM', 'WebWorker'] },
    include: ['use.ts']
  }));
  try { run(`node "${join(root, 'node_modules', 'typescript', 'bin', 'tsc')}" -p .`, project); console.log('the packed type declarations check'); } catch { fail('the packed type declarations do not check in a consumer project'); }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log('package smoke: ok');
