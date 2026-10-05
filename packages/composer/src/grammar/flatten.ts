import type { Grammar, LangiumDocuments } from 'langium';
import { resolveTransitiveImports } from 'langium/grammar';

/**
 * Langium's parser/lexer builders only look at `grammar.rules`, so `import`s must be inlined
 * (what `langium generate` does at build time). Imported entry rules are dropped: one entry per language.
 * Declared `interface`s and `type`s are merged too, so the inferred AST types stay complete.
 */
export function flatten(grammar: Grammar, documents: LangiumDocuments): Grammar {
  const rules = new Set(grammar.rules);
  const interfaces = new Set(grammar.interfaces);
  const types = new Set(grammar.types);
  for (const imported of resolveTransitiveImports(documents, grammar)) {
    for (const rule of imported.rules) {
      if (rule.$type === 'ParserRule' && rule.entry) continue;
      rules.add(rule);
    }
    imported.interfaces.forEach(i => interfaces.add(i));
    imported.types.forEach(t => types.add(t));
  }
  return { ...grammar, rules: [...rules], interfaces: [...interfaces], types: [...types], imports: [] } as Grammar;
}

export const hasEntryRule = (g: Grammar) => g.rules.some(r => r.$type === 'ParserRule' && r.entry);

/** One self-contained `.langium` text for an already flattened grammar (valid input for `langium generate`). */
export function bundleText(flat: Grammar): string {
  const parts = [...flat.interfaces, ...flat.types, ...flat.rules].map(n => n.$cstNode?.text ?? '').filter(Boolean);
  return `grammar ${flat.name ?? 'Bundle'}\n\n${parts.join('\n\n')}\n`;
}
