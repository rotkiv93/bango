import { AstUtils, EmptyFileSystem, URI, type Grammar, type LangiumDocument, type LangiumDocuments } from 'langium';
import {
  createLangiumGrammarServices,
  interpretAstReflection,
  resolveImportUri,
  resolveTransitiveImports
} from 'langium/grammar';
import { compileConstraints, compileSpec } from '../scripts/compile.js';
import { Composition } from './composition.js';
import { flatten, hasEntryRule } from '../grammar/flatten.js';
import { toProblem, wholeFile } from '../model/problems.js';
import type { ComposedMetamodel, CompositionProblem, ConstraintSet, GrammarInfo, SelectionCheck, SpecFn } from '../model/types.js';

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
    const build = await this.ensureBuild();
    const grammars: GrammarInfo[] = build.infos.map(i => ({ ...i, requires: [...i.requires], problems: [...i.problems] }));
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

    const compiled = new Map<string, ConstraintSet | undefined>();
    const constraintsFor = (source: string): ConstraintSet | undefined => {
      if (compiled.has(source)) return compiled.get(source);
      const code = this.constraintTexts.get(source);
      let set: ConstraintSet | undefined;
      if (code?.trim()) {
        try { set = compileConstraints(code); } catch (e) {
          grammars.find(g => g.name === source)?.problems.push(wholeFile('error', `${source}.constraints.js: ${(e as Error).message}`));
        }
      }
      compiled.set(source, set);
      return set;
    };

    const specFor = (name: string): SpecFn | undefined => {
      const code = this.specTexts.get(name);
      if (!code?.trim()) return undefined;
      try { return compileSpec(code); } catch (e) {
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
      usable.push({ ...metamodel, constraints: metamodel.sources.map(constraintsFor).filter((c): c is ConstraintSet => !!c), spec: specFor(name) });
    }

    return new Composition({ selection: names, grammars, problems, usable, unavailable, docs: build.docs });
  }

  // ------------------------------------------------------------------ internals

  private invalidate() {
    this.version++;
    this.build = undefined;
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

  private async runBuild(): Promise<Build> {
    // fresh grammar workspace on every change: grammars are small and this keeps import resolution trivial
    const { shared } = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
    const parsed = [...this.grammarTexts].map(([name, text]) =>
      LangiumDocumentFactory.fromString<Grammar>(text, URI.parse(`memory:/${name}.langium`))
    );
    parsed.forEach(d => LangiumDocuments.addDocument(d));
    await DocumentBuilder.build(parsed, { validation: true });

    const infos: GrammarInfo[] = [];
    const filesByRule = new Map<string, string[]>();
    for (const doc of parsed) {
      const grammar = doc.parseResult.value;
      const name = nameOf(doc);
      const isMetamodel = hasEntryRule(grammar);
      for (const r of grammar.rules) {
        if (r.$type !== 'ParserRule' || r.fragment) continue;
        filesByRule.set(r.name, [...(filesByRule.get(r.name) ?? []), name]);
      }
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

    // rule names are global in the shared index: two metamodels declaring the same rule would silently merge scopes
    for (const [rule, files] of filesByRule) {
      if (files.length < 2) continue;
      for (const info of infos.filter(i => files.includes(i.name))) {
        info.problems.push(wholeFile('warning',
          `Rule '${rule}' is also declared in ${files.filter(f => f !== info.name).join(', ')}; metamodels share one index, so references would mix`));
      }
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
