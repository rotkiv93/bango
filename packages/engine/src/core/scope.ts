import { DefaultScopeProvider, EMPTY_SCOPE, type AstNode, type AstNodeDescription, type LangiumCoreServices, type ReferenceInfo, type Scope } from 'langium';
import type { ScopeFn, ScopeSet } from '@bango/composer';

/**
 * Langium's own extension point for "what can this reference point at": a `ScopeProvider`. This one asks the scope scripts of the
 * metamodel first (`<metamodel>.scope.js`: for a reference feature of a node type, the nodes visible there), and leaves everything
 * they do not decide to Langium's default (every exported node of the right type, across the project).
 *
 * A scope script that decides is final: what it does not list does not resolve (that is the point of narrowing a scope), and a node it
 * lists that is not of the type the reference asks for is ignored.
 */
export class MetamodelScopeProvider extends DefaultScopeProvider {
  constructor(services: LangiumCoreServices, private readonly scopes: readonly ScopeSet[]) {
    super(services);
  }

  /** The scope functions that apply to a reference feature of this node, most specific type first. */
  private functionsFor(container: AstNode, property: string): ScopeFn[] {
    const found: { fn: ScopeFn; exact: boolean }[] = [];
    for (const set of this.scopes) {
      for (const [type, features] of Object.entries(set)) {
        const fn = features[property];
        if (!fn) continue;
        if (type === container.$type) found.push({ fn, exact: true });
        else if (this.reflection.isSubtype(container.$type, type)) found.push({ fn, exact: false });
      }
    }
    return found.sort((a, b) => Number(b.exact) - Number(a.exact)).map(f => f.fn);
  }

  /** Whether a scope script has a say about this reference feature (so a form knows to ask what is visible there). */
  decides(type: string, property: string): boolean {
    return this.scopes.some(set => Object.entries(set).some(([t, features]) => features[property] && (t === type || this.reflection.isSubtype(type, t))));
  }

  override getScope(context: ReferenceInfo): Scope {
    for (const fn of this.functionsFor(context.container, context.property)) {
      const nodes = fn(context.container, { property: context.property, index: context.index });
      if (nodes === undefined || nodes === null) continue;
      if (!Array.isArray(nodes)) throw new Error(`the scope of ${context.container.$type}.${context.property} must return a list of nodes (or undefined), not ${typeof nodes}`);
      return this.scopeOf(nodes, context);
    }
    return super.getScope(context);
  }

  /** The nodes a script listed, as a scope: the ones of the right type that have a name. */
  private scopeOf(nodes: unknown[], context: ReferenceInfo): Scope {
    const wanted = this.reflection.getReferenceType(context);
    const descriptions: AstNodeDescription[] = [];
    for (const node of nodes as AstNode[]) {
      if (!node || typeof node !== 'object' || typeof node.$type !== 'string' || !this.reflection.isSubtype(node.$type, wanted)) continue;
      const name = this.nameProvider.getName(node);
      if (name) descriptions.push(this.descriptions.createDescription(node, name));
    }
    return descriptions.length ? this.createScope(descriptions) : EMPTY_SCOPE;
  }
}
