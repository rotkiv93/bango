// Checks the promises about what a page has to load. Run after `npm run build`:  node scripts/check-bundles.mjs
//  - a page that only talks to a worker loads a tiny client and no parser
//  - the workspace entry point (projects, scripts, saving) does not import Langium
//  - the playground's own code (not the worker) has no Langium in it
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
let failed = 0;
const check = (ok, message) => { if (!ok) { failed++; console.error(`FAIL ${message}`); } else console.log(`ok   ${message}`); };
const read = path => {
  if (!existsSync(path)) { failed++; console.error(`FAIL ${path} is missing: run \`npm run build\` first`); return undefined; }
  return readFileSync(path, 'utf8');
};

/** The source without the text of template literals and comments, which may contain `import '...'` as plain text (a grammar template, a doc comment). */
const withoutStrings = source => source.replace(/`(?:\\.|[^`\\])*`/gs, '``').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** What a module imports: the specifiers of its static `import ... from '...'` and `import '...'` statements. */
const importsOf = text => [...withoutStrings(text).matchAll(/(?:^|[;\n])\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);

// 1. the worker client is small and self-contained
const client = read(join(root, 'packages/core/dist/bundle/client.js'));
if (client) {
  check(client.length < 16 * 1024, `core/bundle/client.js is ${kb(client.length)} (budget 16 KB)`);
  check(!/langium/i.test(client), 'core/bundle/client.js has no Langium');
}

// 2. the workspace entry point imports nothing but @bango/core
const workspace = read(join(root, 'packages/engine/dist/workspace.js'));
if (workspace) {
  const imports = importsOf(workspace);
  check(imports.every(i => i === '@bango/core'), `engine/workspace.js imports only @bango/core (${imports.join(', ') || 'nothing'})`);
  check(workspace.length < 60 * 1024, `engine/workspace.js is ${kb(workspace.length)} (budget 60 KB)`);
}

// 3. the studio: one self-contained module that brings neither Monaco, nor the renderer, nor the engine (the page passes them in)
const studio = read(join(root, 'packages/studio/dist/bundle/studio.js'));
if (studio) {
  check(studio.length < 60 * 1024, `studio/bundle/studio.js is ${kb(studio.length)} (budget 60 KB)`);
  check(!/createLangiumGrammarServices|LangiumDocumentFactory|DefaultScopeProvider/.test(studio), 'studio/bundle/studio.js has no Langium');
  const imports = importsOf(studio);
  check(imports.length === 0, `studio/bundle/studio.js imports nothing (${imports.join(', ') || 'nothing'})`);
  check(!/class\s+\w*\s*extends\s+\w*Renderer|registerRenderer/.test(studio), 'studio/bundle/studio.js has no second copy of the renderer');
}

// 3b. the renderer: views and the toolkit of the visualizations a metamodel brings, with no parser and no import but the optional layout engine
const renderer = read(join(root, 'packages/renderer/dist/bundle/renderer.js'));
if (renderer) {
  check(renderer.length < 200 * 1024, `renderer/bundle/renderer.js is ${kb(renderer.length)} (budget 200 KB)`);
  check(!/createLangiumGrammarServices|LangiumDocumentFactory|DefaultScopeProvider/.test(renderer), 'renderer/bundle/renderer.js has no Langium');
  const imports = importsOf(renderer);
  check(imports.every(i => /^elkjs(\/|$)/.test(i)), `renderer/bundle/renderer.js imports at most elkjs (${imports.join(', ') || 'nothing'})`);
  check(/Canvas/.test(renderer) && /VisualizationStore/.test(renderer), 'renderer/bundle/renderer.js has the visualizations toolkit');
}

// 4. the playground: the page's code has no Langium, the worker's has
const assets = join(root, 'apps/playground/dist/assets');
if (existsSync(assets)) {
  const files = readdirSync(assets).filter(f => f.endsWith('.js'));
  const marker = /createLangiumGrammarServices|LangiumDocumentFactory|DefaultScopeProvider/;
  const main = files.filter(f => /^index-/.test(f));
  check(main.length > 0, 'the playground has a main chunk');
  for (const f of main) check(!marker.test(readFileSync(join(assets, f), 'utf8')), `playground ${f} (${kb(statSync(join(assets, f)).size)}) has no Langium`);
  const workers = files.filter(f => /^bango\.worker-/.test(f));
  check(workers.length > 0 && workers.every(f => marker.test(readFileSync(join(assets, f), 'utf8'))), 'the engine, with Langium, is in the worker chunk');
  const ts = files.filter(f => /^ts\.worker-/.test(f));
  check(ts.length > 0, `the TypeScript service is its own lazy chunk (${ts.map(f => kb(statSync(join(assets, f)).size)).join(', ')})`);
} else {
  failed++;
  console.error('FAIL apps/playground/dist is missing: run `npm run build` first');
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('bundles: ok');
