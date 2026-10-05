import { EmptyFileSystem, inject } from 'langium';
import { createDefaultModule, createDefaultSharedModule, type LangiumServices, type LangiumSharedServices } from 'langium/lsp';
import type { ComposedMetamodel, Composition } from '@bango/composer';

export interface Language {
  metamodel: ComposedMetamodel;
  services: LangiumServices;
}

export interface LanguageSet {
  shared: LangiumSharedServices;
  /** by metamodel name */
  languages: Map<string, Language>;
}

/**
 * One shared Langium container for every metamodel of a composition. Sharing it (documents, index and the
 * merged reflection) is what lets a reference in a `.gismodel` instance resolve to a node of a `.datamodel` one.
 */
export function createLanguages(composition: Composition): LanguageSet {
  const shared = inject(createDefaultSharedModule(EmptyFileSystem), { AstReflection: () => composition.reflection });
  const languages = new Map<string, Language>();
  for (const metamodel of composition.metamodels) {
    const services = inject(createDefaultModule({ shared }), {
      Grammar: () => metamodel.grammar,
      LanguageMetaData: () => ({
        caseInsensitive: false,
        fileExtensions: [`.${metamodel.extension}`],
        languageId: metamodel.extension,
        mode: 'development' as const
      }),
      parser: { ParserConfig: () => ({ skipValidations: false }) }
    });
    shared.ServiceRegistry.register(services);
    // Langium's own registration: checks keyed by AST type name, the validator they run on, and when they run
    for (const { checks, thisObj, category } of metamodel.constraints) services.validation.ValidationRegistry.register(checks as never, thisObj, category);
    languages.set(metamodel.name, { metamodel, services });
  }
  return { shared, languages };
}
