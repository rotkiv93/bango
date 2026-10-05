import { AbstractAstReflection, type AstReflection, type TypeMetaData } from 'langium';

/** Merges the reflections of several metamodels so references between them type-check in one index. */
export class CompositeAstReflection extends AbstractAstReflection {
  readonly types: Record<string, TypeMetaData> = {};

  constructor(parts: AstReflection[]) {
    super();
    for (const part of parts) Object.assign(this.types, part.types);
  }

  protected computeIsSubtype(subtype: string, supertype: string): boolean {
    const meta = this.types[subtype];
    return !!meta && meta.superTypes.some(s => this.isSubtype(s, supertype));
  }
}
