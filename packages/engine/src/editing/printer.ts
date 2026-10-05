import { GrammarAST as G } from 'langium';
import type { AstDto, RefDto } from '@bango/core';
import { isFragment } from './schema.js';

interface Tok { text: string; block?: boolean }

const ind = (level: number) => '  '.repeat(level);

function quote(s: string) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** Renders a node back to concrete syntax by walking its grammar rule (the inverse of parsing). */
export class Printer {
  constructor(private rules: Map<string, G.ParserRule>) {}

  print(dto: AstDto, level = 0): string {
    const rule = this.rules.get(dto.type);
    if (!rule) throw new Error(`No grammar rule produces type '${dto.type}'`);
    const toks = this.emit(rule.definition, dto, new Map(), level, true) ?? this.emit(rule.definition, dto, new Map(), level, false) ?? [];
    return this.join(toks, level);
  }

  private join(toks: Tok[], level: number): string {
    let out = '';
    toks.forEach((t, i) => {
      const prev = toks[i - 1];
      if (t.block) out += '\n' + ind(level + 1) + t.text;
      else if (prev?.block && /^[}\])]$/.test(t.text)) out += '\n' + ind(level) + t.text;
      // a brace that holds child nodes starts its body on a new line, not behind the brace
      else if (prev?.text === '{' && !prev.block && this.holdsBlock(toks, i)) out += '\n' + ind(level + 1) + t.text;
      else {
        // punctuation hugs its neighbours: `name: String`, `a, b`, `f(x)`
        const tight = !i || /^[:,;.)\]]$/.test(t.text) || /^[([.]$/.test(prev?.text ?? '') && !prev?.block;
        out += (tight ? '' : ' ') + t.text;
      }
    });
    return out;
  }

  /** Is there a child node among the tokens from `from` up to the next closing brace? */
  private holdsBlock(toks: Tok[], from: number): boolean {
    for (let j = from; j < toks.length; j++) {
      if (toks[j].block) return true;
      if (toks[j].text === '}') return false;
    }
    return false;
  }

  /** Does the element still have a value to emit? Drives optional groups and repetitions. */
  private hasValue(el: G.AbstractElement, dto: AstDto, used: Map<string, number>, seen = new Set<G.ParserRule>()): boolean {
    if (G.isAssignment(el)) return this.valueAt(el, dto, used) !== undefined;
    if (G.isGroup(el) || G.isAlternatives(el) || G.isUnorderedGroup(el)) return el.elements.some(e => this.hasValue(e, dto, used, seen));
    if (G.isRuleCall(el)) {
      const rule = el.rule.ref;
      return isFragment(rule) && !seen.has(rule) && this.hasValue(rule.definition, dto, used, new Set(seen).add(rule));
    }
    return false;
  }

  private valueAt(a: G.Assignment, dto: AstDto, used: Map<string, number>): unknown {
    const i = used.get(a.feature) ?? 0;
    if (a.operator === '?=') return dto.props[a.feature] === true && i === 0 ? true : undefined;
    const pick = <T,>(v: T | T[] | undefined): T | undefined =>
      a.operator === '+=' ? (Array.isArray(v) ? v[i] : undefined) : i === 0 && !Array.isArray(v) ? v : undefined;
    if (G.isCrossReference(a.terminal)) return pick(dto.refs[a.feature] as RefDto | RefDto[] | undefined);
    const child = pick(dto.children[a.feature] as AstDto | AstDto[] | undefined);
    if (child !== undefined) return child;
    const p = pick(dto.props[a.feature] as unknown as string | string[] | undefined);
    return p === null ? undefined : p;
  }

  private emit(el: G.AbstractElement, dto: AstDto, used: Map<string, number>, level: number, strict: boolean): Tok[] | null {
    const card = el.cardinality;
    if (!card) return this.once(el, dto, used, level, strict);
    if (card === '?') return this.hasValue(el, dto, used) ? this.once(el, dto, used, level, strict) ?? [] : [];
    const out: Tok[] = [];
    let n = 0;
    while (this.hasValue(el, dto, used) && n < 10000) {
      const before = JSON.stringify([...used]);
      const t = this.once(el, dto, used, level, strict);
      if (!t || JSON.stringify([...used]) === before) break;
      out.push(...t);
      n++;
    }
    if (card === '+' && n === 0) {
      if (strict) return null;
      return this.once(el, dto, used, level, false) ?? [];
    }
    return out;
  }

  private once(el: G.AbstractElement, dto: AstDto, used: Map<string, number>, level: number, strict: boolean): Tok[] | null {
    if (G.isKeyword(el)) return [{ text: el.value }];
    if (G.isGroup(el) || G.isUnorderedGroup(el)) {
      const out: Tok[] = [];
      for (const e of el.elements) {
        const t = this.emit(e, dto, used, level, strict);
        if (!t) return null;
        out.push(...t);
      }
      return out;
    }
    if (G.isAlternatives(el)) {
      for (const alt of el.elements) {
        if (!this.hasValue(alt, dto, used)) continue;
        const t = this.emit(alt, dto, used, level, strict);
        if (t) return t;
      }
      // nothing has a value: a purely syntactic choice, take the first branch that can be printed
      for (const alt of el.elements) {
        const t = this.emit(alt, dto, used, level, strict);
        if (t) return t;
      }
      return strict ? null : [];
    }
    if (G.isRuleCall(el)) {
      const rule = el.rule.ref;
      return isFragment(rule) ? this.emit(rule.definition, dto, used, level, strict) : [];
    }
    if (G.isAssignment(el)) return this.assignment(el, dto, used, level, strict);
    return [];
  }

  private assignment(a: G.Assignment, dto: AstDto, used: Map<string, number>, level: number, strict: boolean): Tok[] | null {
    const value = this.valueAt(a, dto, used);
    const t = a.terminal;
    if (a.operator === '?=') {
      if (value !== true) return [];
      used.set(a.feature, 1);
      return [{ text: G.isKeyword(t) ? t.value : a.feature }];
    }
    if (value === undefined) {
      if (strict) return null;
      used.set(a.feature, (used.get(a.feature) ?? 0) + 1);
      return [{ text: G.isRuleCall(t) && G.isTerminalRule(t.rule.ref) && t.rule.ref.name === 'STRING' ? '""' : 'TODO' }];
    }
    used.set(a.feature, (used.get(a.feature) ?? 0) + 1);
    if (G.isCrossReference(t)) return [{ text: (value as RefDto).text }];
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return [{ text: this.print(value as AstDto, level + 1), block: a.operator === '+=' }];
    }
    const quoted = G.isRuleCall(t) && G.isTerminalRule(t.rule.ref) && t.rule.ref.name === 'STRING';
    return [{ text: quoted ? quote(String(value)) : String(value) }];
  }
}
