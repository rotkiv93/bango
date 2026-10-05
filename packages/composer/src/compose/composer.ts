import { interpretAstReflection, resolveTransitiveImports } from 'langium/grammar';
import { AstUtils, GrammarUtils } from 'langium';
import type { GrammarInfo, SelectionCheck } from '@bango/core';
import { flatten } from '../grammar/flatten.js';
import { generateTypings } from '../scripts/typings.js';
import { nameOfDocument } from '../model/documents.js';
import type { ComposedMetamodel } from '../model/types.js';
import { planRenames, rewriteTexts, type RenamePlan } from './collisions.js';
import { Composition } from './composition.js';
import { buildWorkspace, copyInfos, filesOf, importsOf, report, type Build } from './grammar-workspace.js';
import { checkRequirements, hasErrors, suggestSelection } from './requirements.js';
import { ScriptBinder } from './script-binder.js';

/**
 * Holds the metamodels (Langium grammars) of a workspace and composes any selection of them
 * into languages: imports inlined, dependencies checked, constraints compiled.
 */
/** How big a grammar may be (characters). Beyond it the grammar is not read: it is reported, and the metamodel is unavailable. */
export const DEFAULT_MAX_GRAMMAR_CHARS = 1_000_000;

export class ModelComposer {
  constructor(private readonly limits: { maxGrammarChars?: number } = {}) {}

  private get maxGrammarChars() {
    return this.limits.maxGrammarChars ?? DEFAULT_MAX_GRAMMAR_CHARS;
  }

  /** The grammar texts, with the ones over the limit replaced by an empty grammar (and named, so they can be reported). */
  private limited(texts: Map<string, string>): { texts: Map<string, string>; oversized: string[] } {
    const oversized: string[] = [];
    const out = new Map<string, string>();
    for (const [name, text] of texts) {
      if (text.length > this.maxGrammarChars) { oversized.push(name); out.set(name, `grammar ${name.replace(/\W/g, '_')}\n`); } else out.set(name, text);
    }
    return { texts: out, oversized };
  }

  private reportOversized(build: Build, oversized: string[]) {
    for (const name of oversized) {
      report(build.infos, name, 'error', `The grammar is ${(this.grammarTexts.get(name)!.length / 1_000_000).toFixed(1)} million characters, over the limit of ${(this.maxGrammarChars / 1_000_000).toFixed(1)} million: it was not read`);
    }
  }

  private grammarTexts = new Map<string, string>();
  private constraintTexts = new Map<string, string>();
  private specTexts = new Map<string, string>();
  private importTexts = new Map<string, string>();
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

  /** The import mapping of the metamodel called `name`: the inverse of its JSON mapping (see `ImportFn`). */
  setImport(name: string, code: string): this {
    this.importTexts.set(name, code);
    return this;
  }

  get grammarNames(): string[] {
    return [...this.grammarTexts.keys()];
  }

  /** Every grammar of the workspace: metamodels (with an extension) and libraries, with their problems. */
  async metamodels(): Promise<GrammarInfo[]> {
    return copyInfos((await this.ensureBuild()).infos);
  }

  /**
   * TypeScript declarations for the scripts (constraints, JSON mapping) of the grammar `name`: its AST types, with the
   * grammars it imports inlined. Works on the grammar as written, whether or not it is part of a project.
   */
  async typings(name: string): Promise<string> {
    const build = await this.ensureBuild();
    const doc = build.docs.get(name);
    if (!doc) return generateTypings(undefined);
    try {
      const flat = flatten(doc.parseResult.value, build.documents);
      const entry = flat.rules.find(r => r.$type === 'ParserRule' && r.entry);
      return generateTypings(flat, entry && GrammarUtils.getRuleTypeName(entry));
    } catch {
      return generateTypings(undefined);
    }
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
    const suggested = suggestSelection(names, (await this.ensureBuild()).infos);
    return { ok: errors.length === 0, errors, problems: composition.problems, suggested };
  }

  /** Compose a selection of metamodels (every metamodel when omitted). */
  async compose(selection?: string[]): Promise<Composition> {
    const base = await this.ensureBuild();
    const grammars = copyInfos(base.infos);
    const names = [...new Set(selection ?? grammars.filter(g => g.extension).map(g => g.name))];
    const { problems, unavailable } = checkRequirements(names, grammars);

    // Metamodels of one project share one index and one reflection keyed by type name. When two of them declare the
    // same type name, one keeps it and the others get a new one, in a copy of the grammars made for this selection.
    const usage = new Map<string, number>();
    for (const name of names) {
      const info = grammars.find(g => g.name === name);
      if (!info?.extension || unavailable.has(name) || hasErrors(info)) continue;
      for (const file of filesOf(base, name)) usage.set(file, (usage.get(file) ?? 0) + 1);
    }
    const plan = planRenames(base.docs, usage);
    const build = plan.renames.length ? await this.renamedBuild(base, plan, usage) : base;
    for (const r of plan.renames) {
      report(grammars, r.file, 'info', `Type '${r.original}' is also declared by '${r.keeper}': in a project that uses both it is called '${r.renamed}'`);
    }

    const scripts = new ScriptBinder(this.constraintTexts, this.specTexts, this.importTexts, plan, file => importsOf(base, file), grammars);
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
      const spec = scripts.specFor(name);
      usable.push({
        ...metamodel,
        constraints: metamodel.sources.flatMap(s => scripts.constraintsFor(s) ?? []),
        spec: spec?.map,
        specRoot: spec?.root,
        importer: scripts.importFor(name)
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

  /** The grammars again, from texts in which the planned type names replace the clashing ones. Cached per plan. */
  private async renamedBuild(base: Build, plan: RenamePlan, usage: Map<string, number>): Promise<Build> {
    const key = JSON.stringify(plan.renames.map(r => [r.file, r.original, r.renamed]));
    const cached = this.renamedBuilds.get(key);
    if (cached) return cached;
    const texts = new Map(this.grammarTexts);
    for (const [file, text] of rewriteTexts(base.docs, usage.keys(), plan.nodes, this.grammarTexts)) texts.set(file, text);
    const { texts: kept, oversized } = this.limited(texts);
    const build = await buildWorkspace(kept, this.grammarTexts);
    this.reportOversized(build, oversized);
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
      sources: [grammar, ...resolveTransitiveImports(build.documents, grammar)].map(g => nameOfDocument(AstUtils.getDocument(g))),
      requires: info.requires,
      stale: false,
      constraints: []
    };
  }

  private async ensureBuild(): Promise<Build> {
    for (;;) {
      if (this.build) return this.build;
      const version = this.version;
      const { texts, oversized } = this.limited(this.grammarTexts);
      const build = await buildWorkspace(texts, this.grammarTexts);
      this.reportOversized(build, oversized);
      // an edit during the build makes the result obsolete
      if (version === this.version) return (this.build = build);
    }
  }
}
