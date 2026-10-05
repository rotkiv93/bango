import type { Composition } from '@bango/composer';
import { toJsonSpec } from '@bango/core';
import type { BuildResult, InstanceState, JsonValue } from '@bango/core';

/**
 * The final model of a project. It only succeeds when the metamodel selection is complete (every requirement
 * included), every instance belongs to a project metamodel, and every instance validates: grammar rules,
 * cross-metamodel references and constraints alike.
 */
export function buildModel(
  project: string,
  composition: Composition,
  instances: InstanceState[],
  json: { specs: Map<string, JsonValue>; merged: JsonValue; errors: string[] }
): BuildResult {
  const errors: string[] = [...composition.problems.map(p => p.message), ...json.errors];
  const warnings: string[] = [];

  for (const g of composition.grammars.filter(g => composition.selection.includes(g.name))) {
    for (const p of g.problems.filter(p => p.severity === 'error')) {
      errors.push(`${g.name}.langium ${p.startLine + 1}:${p.startColumn + 1} ${p.message}`);
    }
  }
  if (!instances.length) warnings.push('The project has no instances');

  for (const inst of instances) {
    if (!inst.available) {
      errors.push(`${inst.metamodel}: ${inst.problems[0]?.message ?? 'metamodel not available'}`);
      continue;
    }
    for (const p of inst.problems) {
      const line = `${inst.metamodel} ${p.startLine + 1}:${p.startColumn + 1} ${p.message}`;
      if (p.severity === 'error') errors.push(line);
      else if (p.severity === 'warning') warnings.push(line);
    }
  }

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    model: {
      project,
      metamodels: composition.metamodels.map(m => ({ name: m.name, extension: m.extension, requires: m.requires })),
      instances: instances.map(i => ({
        metamodel: i.metamodel,
        extension: composition.get(i.metamodel)!.extension,
        ast: i.ast!,
        spec: json.specs.get(i.metamodel) ?? toJsonSpec(i.ast!)
      })),
      spec: json.merged
    }
  };
}
