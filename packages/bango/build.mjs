// Assembles @lbdudc/bango from the built workspace libraries (run `npm run build:libs` first; `npm run build` does both).
// One package is published instead of five: each library's `dist` goes under `dist/<name>`, and the imports between them
// (`@bango/core`, `@bango/renderer/text`, ...) become relative paths, so nothing in the published files names a package that
// does not exist on the registry.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const here = import.meta.dirname;
const packagesDir = resolve(here, '..');
const dist = join(here, 'dist');
const names = ['core', 'composer', 'engine', 'renderer', 'studio'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/** What `@bango/<name><subpath>` is, as a file under dist/ (the JS the `import` condition names). */
const targets = new Map();
for (const name of names) {
  const dir = join(packagesDir, name);
  if (!existsSync(join(dir, 'dist'))) throw new Error(`packages/${name}/dist is missing: run \`npm run build:libs\` first`);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const file = typeof target === 'string' ? target : (target.import ?? target.default);
    targets.set(`@bango/${name}${subpath.slice(1)}`, join(dist, name, file.replace(/^\.\/dist\//, '')));
  }
  cpSync(join(dir, 'dist'), join(dist, name), { recursive: true });
}

// a bare import of one of our packages, in a JS file or a declaration file, in either kind of quote
const specifier = /(["'])(@bango\/[a-z]+(?:\/[^"']*)?)\1/g;
const slashes = path => path.split(/[\\/]/).join('/');
let rewritten = 0;
const walk = dir => {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) { walk(file); continue; }
    if (!/\.(js|mjs|d\.ts)$/.test(entry)) continue;
    const text = readFileSync(file, 'utf8');
    const next = text.replace(specifier, (_whole, quote, spec) => {
      const target = targets.get(spec);
      if (!target) throw new Error(`${slashes(relative(dist, file))} imports ${spec}, which no workspace package exports`);
      rewritten++;
      let rel = slashes(relative(dirname(file), target));
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${quote}${rel}${quote}`;
    });
    if (next !== text) writeFileSync(file, next);
  }
};
walk(dist);

// every entry point of package.json must exist
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
let missing = 0;
for (const [subpath, target] of Object.entries(pkg.exports)) {
  for (const file of typeof target === 'string' ? [target] : Object.values(target)) {
    if (!existsSync(join(here, file))) { console.error(`exports ${subpath}: ${file} is not in dist`); missing++; }
  }
}
if (missing) process.exit(1);
console.log(`@lbdudc/bango assembled: ${names.length} libraries, ${rewritten} imports made relative`);
