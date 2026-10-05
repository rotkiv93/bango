/** A project picks the metamodels it uses and owns one instance (text) per metamodel. */
interface Project {
  name: string;
  /** metamodel (grammar) names */
  metamodels: string[];
  /** metamodel name -> instance text */
  instances: Record<string, string>;
}

import type { MetamodelCase } from '@bango/core';

/** Everything that is persisted: metamodels shared by all projects, plus the projects. */
export interface Workspace {
  /** grammar name (file name without extension) -> Langium text */
  grammars: Record<string, string>;
  /** metamodel name -> constraints code */
  constraints: Record<string, string>;
  /** metamodel name -> JSON mapping code: the piece of the product specification the metamodel owns */
  specs: Record<string, string>;
  /** metamodel name -> its test cases: sample instances and what they must report */
  cases: Record<string, MetamodelCase[]>;
  projects: Record<string, Project>;
}
