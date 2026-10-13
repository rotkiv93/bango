import { AbstractAstReflection, type AstReflection, type TypeMetaData } from 'langium';

/**
 * Merges the reflections of several metamodels so references between them type-check in one index.
 *
 * Every metamodel describes the types it knows, including the ones it imports, and each only knows the relations of its own grammar:
 * `datamodel` knows `Entity`, while `security` also knows that `Entity` is one of the things a `Resource` can be. The same type therefore
 * appears in several reflections with different super types, and all of them are true at once: the merge is the **union** of what each
 * says, never the last one's version. (Keeping only one lost `Entity ⊂ Resource` as soon as a metamodel that does not know `Resource`
 * came after `security`, and every reference to a `Resource` stopped resolving.)
 */
export class CompositeAstReflection extends AbstractAstReflection {
  readonly types: Record<string, TypeMetaData> = {};

  constructor(parts: AstReflection[]) {
    super();
    for (const part of parts) {
      for (const [name, incoming] of Object.entries(part.types)) {
        const known = this.types[name];
        this.types[name] = known
          ? {
              ...known,
              properties: { ...known.properties, ...incoming.properties },
              superTypes: [...new Set([...known.superTypes, ...incoming.superTypes])]
            }
          : { ...incoming, properties: { ...incoming.properties }, superTypes: [...incoming.superTypes] };
      }
    }
  }

  protected computeIsSubtype(subtype: string, supertype: string): boolean {
    const meta = this.types[subtype];
    return !!meta && meta.superTypes.some(s => this.isSubtype(s, supertype));
  }
}
