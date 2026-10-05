import type { GrammarInfo } from '@bango/core';
import type { ConstraintSet, ImportFn, ScriptHelpers, SpecFn } from '../model/types.js';
import { DEFAULT_HELPERS, compileConstraints, compileImport, compileSpec } from '../scripts/compile.js';
import type { RenamePlan } from './collisions.js';
import { report } from './grammar-workspace.js';

/**
 * Compiles the user's constraints and JSON mappings for one composition, in the light of its type renames: scripts see the
 * names their author wrote (`typeName`), and a constraint key that names a renamed type applies to the renamed one.
 * Compile errors are reported on the grammar the script belongs to.
 */
export class ScriptBinder {
  private readonly helpers: ScriptHelpers;
  private readonly compiled = new Map<string, ConstraintSet | undefined>();

  constructor(
    private readonly constraintTexts: Map<string, string>,
    private readonly specTexts: Map<string, string>,
    private readonly importTexts: Map<string, string>,
    private readonly plan: RenamePlan,
    /** the grammar files a grammar imports, in the grammars as written */
    private readonly importsOf: (grammar: string) => string[],
    private readonly infos: GrammarInfo[]
  ) {
    const original = new Map(plan.renames.map(r => [r.renamed, r.original]));
    this.helpers = {
      ...DEFAULT_HELPERS,
      typeName: node => {
        const type = (node as { $type?: string } | undefined)?.$type;
        return type === undefined ? type : original.get(type) ?? type;
      }
    };
  }

  /** The compiled constraints of one grammar file, if it has any (and they compile). */
  constraintsFor(source: string): ConstraintSet | undefined {
    if (this.compiled.has(source)) return this.compiled.get(source);
    const code = this.constraintTexts.get(source);
    let set: ConstraintSet | undefined;
    if (code?.trim()) {
      try { set = this.translate(source, compileConstraints(code, this.helpers)); } catch (e) {
        report(this.infos, source, 'error', `${source}.constraints.js: ${(e as Error).message}`);
      }
    }
    this.compiled.set(source, set);
    return set;
  }

  /** The compiled JSON mapping of a metamodel, if it has one (and it compiles). */
  specFor(name: string): { map: SpecFn; root: boolean } | undefined {
    const code = this.specTexts.get(name);
    if (!code?.trim()) return undefined;
    try { return compileSpec(code, this.helpers); } catch (e) {
      report(this.infos, name, 'error', `${name}.spec.js: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** The compiled import mapping of a metamodel, if it has one (and it compiles). */
  importFor(name: string): ImportFn | undefined {
    const code = this.importTexts.get(name);
    if (!code?.trim()) return undefined;
    try { return compileImport(code, this.helpers); } catch (e) {
      report(this.infos, name, 'error', `${name}.import.js: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** A constraint is written against the names its author knows: a key that names a renamed type means the renamed one. */
  private translate(source: string, set: ConstraintSet): ConstraintSet {
    if (!this.plan.renames.length) return set;
    const visible = [source, ...this.importsOf(source)];
    const out: ConstraintSet = {};
    for (const [key, fn] of Object.entries(set)) {
      const declared = visible.flatMap(f => this.plan.declarations.get(f) ?? []).find(d => d.name === key);
      out[(declared && this.plan.nodes.get(declared.node)) ?? key] = fn;
    }
    return out;
  }
}
