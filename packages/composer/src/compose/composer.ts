import { AstUtils, EmptyFileSystem, URI, type Grammar, type LangiumDocument, type LangiumDocuments } from 'langium';
import {
  createLangiumGrammarServices,
  interpretAstReflection,
  resolveImportUri,
  resolveTransitiveImports
} from 'langium/grammar';
import { compileConstraints, compileSpec } from '../scripts/compile.js';
import { planRenames, rewriteTexts, type RenamePlan } from './collisions.js';
import { Composition } from './composition.js';
import { flatten, hasEntryRule } from '../grammar/flatten.js';
import { toProblem, wholeFile } from '../model/problems.js';
import type { CompositionProblem, GrammarInfo, SelectionCheck } from '@bango/core';
import type { ComposedMetamodel, ConstraintSet, SpecFn } from '../model/types.js';

interface Build {
  docs: Map<string, LangiumDocument<Grammar>>;
  documents: LangiumDocuments;
  infos: GrammarInfo[];
}

/** The first non-empty `//` comment line: the author's one-line description of the metamodel. */
function describeGrammar(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const m = /^\s*\/\/\s?(.*)$/.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return undefined;
}

const nameOf = (doc: LangiumDocument) => doc.uri.path.slice(1).replace(/\.langium$/, '');
const hasErrors = (g: GrammarInfo) => g.problems.some(p => p.severity === 'error');

/**
 * Holds the metamodels (Langium grammars) of a workspace and composes any selection of them
 * into languages: imports inlined, dependencies checked, constraints compiled.
 */
export class ModelComposer {
  private grammarTexts = new Map<string, string>();
  private constraintTexts = new Map<string, string>();
  private specTexts = new Map<string, string>();
  private lastGood = new Map<string, ComposedMetamodel>();
  private build?: Build;
  /** grammar workspaces built from texts with renamed types, by plan (one per distinct set of collisions) */
  private renamedBuilds = new Map<string, Build>();
  private version = 0;

  /** Add or replace a metamodel. `name` is the grammar file name without extension. */
  setGrammar(name: string, text: string): this {
    this.grammarTexts.set(name, text);
    this.invalidate();
    return this;
  }

  removeGrammar(name: string): this {
    this.grammarTexts.delete(name);
    this.lastGood.delete(name);
    this.invalidate();
    return this;
  }

  /** Validation rules the grammar cannot express, for the metamodel called `name`. */
  setConstraints(name: string, code: string): this {
    this.constraintTexts.set(name, code);
    return this;
  }

  /** The JSON mapping of the metamodel called `name` (see `SpecFn`). */
  setSpec(name: string, code: string): this {
    this.specTexts.set(name, code);
    return this;
  }

  get grammarNames(): string[] {
    return [...this.grammarTexts.keys()];
  }

  /** Every grammar of the workspace: metamodels (with an extension) and libraries, with their problems. */
  async metamodels(): Promise<GrammarInfo[]> {
    const build = await this.ensureBuild();
    return build.infos.map(i => ({ ...i, requires: [...i.requires], problems: [...i.problems] }));
  }

  /**
   * Whether a selection can become a project. A selection is valid when it is not empty, names only existing
   * metamodels, includes everything each metamodel requires, and none of them has grammar errors.
   */
  async check(selection: string[]): Promise<SelectionCheck> {
    const names = [...new Set(selection)];
    const composition = await this.compose(names);
    const errors: string[] = [];
    if (!names.length) errors.push('Select at least one metamodel');
    errors.push(...composition.problems.map(p => p.message));
    for (const name of names) {
      const g = composition.grammars.find(g => g.name === name);
      if (!g?.extension) continue; // already reported as a problem
      const firstError = g.problems.find(p => p.severity === 'error');
      if (firstError) errors.push(`'${name}' has errors in its grammar (${firstError.startLine + 1}:${firstError.startColumn + 1} ${firstError.message})`);
    }

    // what to select to satisfy every requirement
    const build = await this.ensureBuild();
    const suggested = [...names];
    for (const name of names) {
      for (const req of build.infos.find(i => i.name === name)?.requires ?? []) if (!suggested.includes(req)) suggested.push(req);
    }
    return { ok: errors.length === 0, errors, problems: composition.problems, suggested };
  }

  /** Compose a selection of metamodels (every metamodel when omitted). */
  async compose(selection?: string[]): Promise<Composition> {
    const base = await this.ensureBuild();
    const grammars: GrammarInfo[] = base.infos.map(i => ({ ...i, requires: [...i.requires], problems: [...i.problems] }));
    const names = [...new Set(selection ?? grammars.filter(g => g.extension).map(g => g.name))];
    const enabled = new Set(names);

    // a metamodel needs every metamodel it imports to be part of the selection
    const problems: CompositionProblem[] = [];
    const unavailable = new Map<string, string>();
    for (const name of names) {
      const g = grammars.find(g => g.name === name);
      if (!g?.extension) {
        problems.push({ metamodel: name, missing: name, message: `The project uses '${name}', but there is no metamodel with that name` });
        continue;
      }
      const missing = g.requires.filter(req => !enabled.has(req));
      for (const req of missing) {
        problems.push({ metamodel: name, missing: req, message: `'${name}' needs '${req}': add '${req}' to this project` });
      }
      if (missing.length) {
        // the reason a metamodel cannot be used names everything that is missing, not just the last one
        const list = missing.map(m => `'${m}'`).join(', ');
        unavailable.set(name, `'${name}' needs ${list}: add ${list} to this project`);
      }
    }

    // Metamodels of one project share one index and one reflection keyed by type name. When two of them declare the
    // same type name, one keeps it and the others get a new one, in a copy of the grammars made for this selection.
    const files = (name: string) => this.filesOf(base, name);
    const usage = new Map<string, number>();
    for (const name of names) {
      const info = grammars.find(g => g.name === name);
      if (!info?.extension || unavailable.has(name) || hasErrors(info)) continue;
      for (const file of files(name)) usage.set(file, (usage.get(file) ?? 0) + 1);
    }
    const plan = planRenames(base.docs, usage);
    const build = plan.renames.length ? await this.renamedBuild(base, plan, usage) : base;
    for (const r of plan.renames) {
      grammars.find(g => g.name === r.file)?.problems.push(wholeFile('info',
        `Type '${r.original}' is also declared by '${r.keeper}': in a project that uses both it is called '${r.renamed}'`));
    }
    const typeNames = new Map(plan.renames.map(r => [r.renamed, r.original]));
    const helpers = { typeName: (node: unknown) => { const t = (node as { $type?: string } | undefined)?.$type; return t === undefined ? t : typeNames.get(t) ?? t; } };

    // a constraint is written against the names its author knows: a key that names a renamed type means the renamed one
    const translate = (source: string, set: ConstraintSet): ConstraintSet => {
      if (!plan.renames.length) return set;
      const visible = [source, ...this.importsOf(base, source)];
      const out: ConstraintSet = {};
      for (const [key, fn] of Object.entries(set)) {
        const declared = visible.flatMap(f => plan.declarations.get(f) ?? []).find(d => d.name === key);
        out[(declared && plan.nodes.get(declared.node)) ?? key] = fn;
      }
      return out;
    };

    const compiled = new Map<string, ConstraintSet | undefined>();
    const constraintsFor = (source: string): ConstraintSet | undefined => {
      if (compiled.has(source)) return compiled.get(source);
      const code = this.constraintTexts.get(source);
      let set: ConstraintSet | undefined;
      if (code?.trim()) {
        try { set = translate(source, compileConstraints(code, helpers)); } catch (e) {
          grammars.find(g => g.name === source)?.problems.push(wholeFile('error', `${source}.constraints.js: ${(e as Error).message}`));
        }
      }
      compiled.set(source, set);
      return set;
    };

    const specFor = (name: string): { map: SpecFn; root: boolean } | undefined => {
      const code = this.specTexts.get(name);
      if (!code?.trim()) return undefined;
      try { return compileSpec(code, helpers); } catch (e) {
        grammars.find(g => g.name === name)?.problems.push(wholeFile('error', `${name}.spec.js: ${(e as Error).message}`));
        return undefined;
      }
    };

    const usable: ComposedMetamodel[] = [];
    for (const name of names) {
      const info = grammars.find(g => g.name === name);
      if (!info?.extension || unavailable.has(name)) continue;
      let metamodel: ComposedMetamodel;
      if (hasErrors(info)) {
        // a broken grammar keeps serving the last version that compiled, if there was one
        const last = this.lastGood.get(name);
        if (!last) {
          unavailable.set(name, `Metamodel '${name}' has errors, fix it to use it`);
          continue;
        }
        metamodel = { ...last, stale: true };
      } else {
        metamodel = this.compileMetamodel(build, name, info);
        this.lastGood.set(name, metamodel);
      }
      const spec = specFor(name);
      usable.push({
        ...metamodel,
        constraints: metamodel.sources.map(constraintsFor).filter((c): c is ConstraintSet => !!c),
        spec: spec?.map,
        specRoot: spec?.root
      });
    }

    // the grammars as the user wrote them (not the renamed copies) are what is shown and inspected
    return new Composition({ selection: names, grammars, problems, usable, unavailable, docs: base.docs, renames: plan.renames });
  }

  // ------------------------------------------------------------------ internals

  private invalidate() {
    this.version++;
    this.build = undefined;
    this.renamedBuilds.clear();
  }

  /** The grammar files a metamodel includes: its own and everything it imports. */
  private filesOf(build: Build, name: string): string[] {
    const doc = build.docs.get(name);
    return doc ? [name, ...this.importsOf(build, name)] : [];
  }

  private importsOf(build: Build, name: string): string[] {
    const doc = build.docs.get(name);
    return doc ? resolveTransitiveImports(build.documents, doc.parseResult.value).map(g => nameOf(AstUtils.getDocument(g))) : [];
  }

  /** The grammars again, from texts in which the planned type names replace the clashing ones. Cached per plan. */
  private async renamedBuild(base: Build, plan: RenamePlan, usage: Map<string, number>): Promise<Build> {
    const key = JSON.stringify(plan.renames.map(r => [r.file, r.original, r.renamed]));
    const cached = this.renamedBuilds.get(key);
    if (cached) return cached;
    const texts = new Map(this.grammarTexts);
    for (const [file, text] of rewriteTexts(base.docs, usage.keys(), plan.nodes, this.grammarTexts)) texts.set(file, text);
    const build = await this.runBuild(texts);
    this.renamedBuilds.set(key, build);
    return build;
  }

  private compileMetamodel(build: Build, name: string, info: GrammarInfo): ComposedMetamodel {
    const grammar = build.docs.get(name)!.parseResult.value;
    const flat = flatten(grammar, build.documents);
    return {
      name,
      extension: info.extension!,
      grammar: flat,
      reflection: interpretAstReflection(flat),
      sources: [grammar, ...resolveTransitiveImports(build.documents, grammar)].map(g => nameOf(AstUtils.getDocument(g))),
      requires: info.requires,
      stale: false,
      constraints: []
    };
  }

  private async ensureBuild(): Promise<Build> {
    for (;;) {
      if (this.build) return this.build;
      const version = this.version;
      const build = await this.runBuild();
      // an edit during the build makes the result obsolete
      if (version === this.version) return (this.build = build);
    }
  }

  private async runBuild(texts: Map<string, string> = this.grammarTexts): Promise<Build> {
    // fresh grammar workspace on every change: grammars are small and this keeps import resolution trivial
    const { shared } = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
    const parsed = [...texts].map(([name, text]) =>
      LangiumDocumentFactory.fromString<Grammar>(text, URI.parse(`memory:/${name}.langium`))
    );
    parsed.forEach(d => LangiumDocuments.addDocument(d));
    await DocumentBuilder.build(parsed, { validation: true });

    const infos: GrammarInfo[] = [];
    for (const doc of parsed) {
      const grammar = doc.parseResult.value;
      const name = nameOf(doc);
      const isMetamodel = hasEntryRule(grammar);
      infos.push({
        name,
        extension: isMetamodel ? (grammar.name ?? name).toLowerCase() : undefined,
        description: describeGrammar(this.grammarTexts.get(name) ?? ''),
        imports: grammar.imports.map(i => resolveImportUri(i)?.path.slice(1).replace(/\.langium$/, '')).filter((x): x is string => !!x),
        requires: isMetamodel
          ? resolveTransitiveImports(LangiumDocuments, grammar).filter(hasEntryRule).map(g => nameOf(AstUtils.getDocument(g)))
          : [],
        // grammars without an entry rule are libraries (e.g. shared terminals), not metamodels
        problems: (doc.diagnostics ?? []).map(toProblem).filter(p => isMetamodel || !/missing an entry parser rule/.test(p.message))
      });
    }

    // the language registry maps one file extension to one language
    const byExtension = new Map<string, GrammarInfo[]>();
    for (const i of infos) if (i.extension) byExtension.set(i.extension, [...(byExtension.get(i.extension) ?? []), i]);
    for (const [ext, list] of byExtension) {
      if (list.length < 2) continue;
      for (const i of list) {
        i.problems.push(wholeFile('error', `Extension '.${ext}' is also used by ${list.filter(x => x !== i).map(x => x.name).join(', ')}: grammar names must be unique`));
      }
    }

    return { docs: new Map(parsed.map(d => [nameOf(d), d])), documents: LangiumDocuments, infos };
  }
}
