import { AstUtils, GrammarAST, GrammarUtils, type AstNode, type Grammar, type LangiumDocument } from 'langium';
import type { TypeRename } from '../model/types.js';

/** A declaration of an AST type in a grammar: a parser rule, an `infers` name, an `interface` or a `type`. */
export interface Declaration {
  file: string;
  name: string;
  node: AstNode;
}

export interface RenamePlan {
  renames: TypeRename[];
  /** the declaration nodes that get a new name */
  nodes: Map<AstNode, string>;
  /** every declaration of the files in use, by file */
  declarations: Map<string, Declaration[]>;
}

/**
 * The AST types a grammar declares. Rules that `return` another type, data type rules, fragments and terminals
 * declare none: they do not appear in the shared index or in the merged reflection.
 */
export function declarationsOf(file: string, grammar: Grammar): Declaration[] {
  const out: Declaration[] = [];
  for (const rule of grammar.rules) {
    if (!GrammarAST.isParserRule(rule) || rule.fragment || rule.dataType || rule.returnType) continue;
    if (rule.inferredType) out.push({ file, name: rule.inferredType.name, node: rule.inferredType });
    else out.push({ file, name: rule.name, node: rule });
  }
  for (const i of grammar.interfaces) out.push({ file, name: i.name, node: i });
  for (const t of grammar.types) out.push({ file, name: t.name, node: t });
  return out;
}

const pascal = (file: string) => {
  const p = file.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(p) ? p : `M${p}`;
};

/**
 * Metamodels of one project share one index and one merged type reflection, both keyed by type name: two
 * different declarations with the same name would mix their scopes and overwrite each other's properties.
 *
 * So when the grammars in use declare the same type name in different files, one keeps it and the others are
 * renamed (`Entity` of `billing` becomes `BillingEntity`). The one that keeps the name is the one most of the
 * metamodels in the project use (the data model that others import, say); ties go to the first file by name.
 *
 * `usage` is the number of metamodels in the project that include each grammar file (itself and the ones that import it).
 */
export function planRenames(docs: Map<string, LangiumDocument<Grammar>>, usage: Map<string, number>): RenamePlan {
  const declarations = new Map<string, Declaration[]>();
  const byName = new Map<string, Declaration[]>();
  for (const file of usage.keys()) {
    const doc = docs.get(file);
    if (!doc) continue;
    const list = declarationsOf(file, doc.parseResult.value);
    declarations.set(file, list);
    for (const d of list) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  }

  const taken = new Set(byName.keys());
  const renames: TypeRename[] = [];
  const nodes = new Map<AstNode, string>();
  for (const name of [...byName.keys()].sort()) {
    const list = byName.get(name)!;
    if (new Set(list.map(d => d.file)).size < 2) continue;
    const ranked = [...list].sort((a, b) => (usage.get(b.file)! - usage.get(a.file)!) || a.file.localeCompare(b.file));
    const keeper = ranked[0];
    for (const loser of ranked.slice(1)) {
      if (loser.file === keeper.file) continue;
      let renamed = `${pascal(loser.file)}${name}`;
      for (let n = 2; taken.has(renamed); n++) renamed = `${pascal(loser.file)}${name}${n}`;
      taken.add(renamed);
      nodes.set(loser.node, renamed);
      renames.push({ file: loser.file, original: name, renamed, keeper: keeper.file });
    }
  }
  return { renames, nodes, declarations };
}

/**
 * The grammar texts with the planned names: every declaration that is renamed, and every reference to it, in every
 * file in use (a metamodel that imports the renamed grammar says `[BillingEntity:ID]` where it said `[Entity:ID]`).
 * Only identifiers change, so the grammars mean the same thing.
 */
export function rewriteTexts(
  docs: Map<string, LangiumDocument<Grammar>>,
  files: Iterable<string>,
  nodes: Map<AstNode, string>,
  texts: Map<string, string>
): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of files) {
    const doc = docs.get(file);
    const text = texts.get(file);
    if (!doc || text === undefined) continue;

    const edits = new Map<number, { start: number; end: number; text: string }>();
    const add = (cst: { offset: number; end: number } | undefined, replacement: string) => {
      if (cst) edits.set(cst.offset, { start: cst.offset, end: cst.end, text: replacement });
    };

    for (const node of AstUtils.streamAst(doc.parseResult.value)) {
      const renamed = nodes.get(node);
      if (renamed !== undefined) add(GrammarUtils.findNodeForProperty(node.$cstNode, 'name'), renamed);
      for (const info of AstUtils.streamReferences(node)) {
        // (a multi-reference has several targets: the grammar language has none)
        const target = 'ref' in info.reference ? info.reference.ref : undefined;
        const to = target && nodes.get(target);
        if (to !== undefined) add(info.reference.$refNode, to);
      }
    }
    if (!edits.size) continue;

    let out = text;
    for (const e of [...edits.values()].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    result.set(file, out);
  }
  return result;
}
