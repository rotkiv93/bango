import { AstUtils, GrammarAST, type AstReflection, type LangiumDocument } from 'langium';
import { toAstDto } from '../model/ast-dto.js';
import { bundleText } from '../grammar/flatten.js';
import { CompositeAstReflection } from '../grammar/reflection.js';
import type { AstDto, ComposedMetamodel, CompositionInfo, CompositionProblem, GrammarInfo, TypeRename } from '../model/types.js';

export interface CompositionParts {
  selection: string[];
  grammars: GrammarInfo[];
  problems: CompositionProblem[];
  usable: ComposedMetamodel[];
  /** metamodels of the selection that cannot be used, with the reason */
  unavailable: Map<string, string>;
  /** the parsed grammar documents, by grammar name */
  docs: Map<string, LangiumDocument>;
  /** type names that had to be renamed because metamodels of the selection declare the same one */
  renames: TypeRename[];
}

/**
 * The result of composing a selection of metamodels: which languages exist, which are blocked
 * by a missing dependency, and everything the engine needs to create the languages.
 */
export class Composition {
  readonly selection: string[];
  readonly grammars: GrammarInfo[];
  readonly problems: CompositionProblem[];
  readonly metamodels: ComposedMetamodel[];
  /** type names renamed in this composition (empty when no two metamodels declare the same type) */
  readonly renames: TypeRename[];
  /** all usable metamodels merged, so cross-metamodel references type-check */
  readonly reflection: AstReflection;
  private readonly unavailable: Map<string, string>;
  private readonly docs: Map<string, LangiumDocument>;

  constructor(parts: CompositionParts) {
    this.selection = parts.selection;
    this.grammars = parts.grammars;
    this.problems = parts.problems;
    this.metamodels = parts.usable;
    this.unavailable = parts.unavailable;
    this.docs = parts.docs;
    this.renames = parts.renames;
    this.reflection = new CompositeAstReflection(parts.usable.map(m => m.reflection));
  }

  /** No dependency problems and no errors in any metamodel of the selection. */
  get ok(): boolean {
    return (
      this.problems.length === 0 &&
      this.selection.every(name => {
        const g = this.grammars.find(g => g.name === name);
        return !!g && !g.problems.some(p => p.severity === 'error') && !this.unavailable.has(name);
      })
    );
  }

  get(name: string): ComposedMetamodel | undefined {
    return this.metamodels.find(m => m.name === name);
  }

  byExtension(extension: string): ComposedMetamodel | undefined {
    return this.metamodels.find(m => m.extension === extension);
  }

  /** Why a metamodel cannot be used in this composition, or undefined when it can. */
  explainUnavailable(name: string): string | undefined {
    if (this.get(name)) return undefined;
    const g = this.grammars.find(g => g.name === name && g.extension);
    if (!g) return `No metamodel named '${name}'`;
    if (!this.selection.includes(name)) return `Metamodel '${name}' is not part of this project: add it to use it`;
    return this.unavailable.get(name) ?? `Metamodel '${name}' has errors, fix it to use it`;
  }

  /** The type of a node as its metamodel's author wrote it: `node.$type` without the renames of this composition. */
  typeName(node: { $type?: string } | undefined): string | undefined {
    const type = node?.$type;
    return this.renames.find(r => r.renamed === type)?.original ?? type;
  }

  /** The AST of a grammar itself (what the metamodel text parses to), for any grammar of the workspace. */
  grammarAst(name: string): AstDto | undefined {
    const doc = this.docs.get(name);
    return doc && toAstDto(doc.parseResult.value);
  }

  /** One self-contained `.langium` text for a metamodel, with every import inlined. */
  bundleText(name: string): string {
    const m = this.get(name);
    if (!m) throw new Error(this.explainUnavailable(name));
    return bundleText(m.grammar);
  }

  /** Serializable summary for code that cannot hold Langium objects (a page talking to a worker). */
  info(): CompositionInfo {
    return {
      selection: this.selection,
      grammars: this.grammars,
      problems: this.problems,
      renames: this.renames,
      languages: this.metamodels.map(m => ({
        name: m.name,
        extension: m.extension,
        stale: m.stale,
        keywords: [...new Set(AstUtils.streamAllContents(m.grammar).filter(GrammarAST.isKeyword).map(k => k.value))]
      }))
    };
  }
}
