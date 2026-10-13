/**
 * Checks a folder of metamodels (LINEA's `metamodels` repository, or any folder laid out like it), and optionally keeps examples/seed in step with it.
 *
 *   node scripts/check-metamodels.mjs <dir>            every metamodel in <dir> is well formed
 *   node scripts/check-metamodels.mjs <dir> --seed     ...and examples/seed has exactly the same files
 *   node scripts/check-metamodels.mjs <dir> --sync     ...and copies them there when it does not
 *
 * (npm run check:metamodels -- <dir> [--seed | --sync])
 *
 * Well formed: a folder <name>/ with a metamodel.json (name = the folder, a semver version, `requires` resolving to sibling folders)
 * and one folder per kind of file, each file named after the grammar it belongs to:
 *
 *   grammars/<g>.langium         the grammar (at least one; the one named like the metamodel is the one it is about)
 *   constraints/<g>.js           its validation rules
 *   specs/<g>.js                 its JSON mapping
 *   imports/<g>.js               the inverse of the mapping
 *   scopes/<g>.js                which nodes each reference can point at
 *   visualizations/<g>.js        the views of its instances that only it knows how to draw
 *   cases/<g>.json               sample instances and what they must report
 *
 * The metamodels repository is the source of the metamodels; examples/seed (the same folders with every metamodel's files side by side)
 * is only what bango's tests and playground ship.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: check-metamodels.mjs <metamodels dir> [--seed | --sync]'); process.exit(2); }
const root = path.resolve(dir);
const sync = args.includes('--sync');
const seed = sync || args.includes('--seed') ? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'seed') : undefined;

/** folder -> extension of its files */
const KINDS = { grammars: '.langium', constraints: '.js', specs: '.js', imports: '.js', scopes: '.js', visualizations: '.js', cases: '.json' };

const problems = [];
const names = fs.readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !['scripts', 'node_modules'].includes(e.name) && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();

/** relative path (forward slashes) -> absolute path, of every file a metamodel brings */
const filesOf = new Map();

for (const name of names) {
  const dir = path.join(root, name);
  const manifestPath = path.join(dir, 'metamodel.json');
  if (!fs.existsSync(manifestPath)) { problems.push(`${name}: no metamodel.json`); continue; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== name) problems.push(`${name}: metamodel.json says name "${manifest.name}"`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) problems.push(`${name}: version "${manifest.version}" is not X.Y.Z`);
  for (const reference of Object.keys(manifest.requires ?? {})) {
    if (!names.includes(path.basename(reference)) || path.dirname(reference) !== '..') problems.push(`${name}: requires "${reference}", which is not a sibling folder`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== 'metamodel.json');
  for (const entry of entries) {
    if (!entry.isDirectory() || !(entry.name in KINDS)) problems.push(`${name}: ${entry.name} is not one of ${Object.keys(KINDS).join(', ')}`);
  }
  const grammars = fs.existsSync(path.join(dir, 'grammars')) ? fs.readdirSync(path.join(dir, 'grammars')).filter((f) => f.endsWith('.langium')).map((f) => f.slice(0, -'.langium'.length)) : [];
  if (!grammars.length) problems.push(`${name}: no grammars/<grammar>.langium`);
  else if (!grammars.includes(name)) problems.push(`${name}: no grammars/${name}.langium`);

  for (const [kind, extension] of Object.entries(KINDS)) {
    const folder = path.join(dir, kind);
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder)) {
      const grammar = file.endsWith(extension) ? file.slice(0, -extension.length) : undefined;
      if (grammar === undefined) problems.push(`${name}: ${kind}/${file} should end with ${extension}`);
      else if (!grammars.includes(grammar)) problems.push(`${name}: ${kind}/${file} belongs to the grammar "${grammar}", which is not in grammars/`);
      filesOf.set(`${kind}/${file}`, path.join(folder, file));
    }
  }
}

if (seed) {
  const theirs = new Set();
  for (const kind of Object.keys(KINDS)) {
    const folder = path.join(seed, kind);
    if (fs.existsSync(folder)) for (const file of fs.readdirSync(folder)) theirs.add(`${kind}/${file}`);
  }
  for (const [file, from] of filesOf) {
    const to = path.join(seed, file);
    if (theirs.has(file) && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;
    if (sync) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); console.log(`synced ${file}`); }
    else problems.push(`seed: ${file} ${theirs.has(file) ? 'differs' : 'is missing'} (run with --sync)`);
  }
  for (const file of theirs) {
    if (filesOf.has(file)) continue;
    if (sync) { fs.rmSync(path.join(seed, file)); console.log(`removed ${file}`); }
    else problems.push(`seed: ${file} is not in this repository`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${names.length} metamodels${seed ? ', in step with examples/seed' : ''}`);
