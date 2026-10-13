import type { CompositionProblem, GrammarInfo } from '@bango/core';

/**
 * What stops a selection from being a project as far as requirements go: a name that is no metamodel, and every metamodel
 * a selected one imports that is not selected. `unavailable` says why each affected metamodel cannot be used.
 */
export function checkRequirements(names: string[], grammars: GrammarInfo[]): { problems: CompositionProblem[]; unavailable: Map<string, string> } {
  const enabled = new Set(names);
  const problems: CompositionProblem[] = [];
  const unavailable = new Map<string, string>();
  for (const name of names) {
    const g = grammars.find(g => g.name === name);
    if (!g?.extension) {
      problems.push({ metamodel: name, missing: name, message: `The project uses '${name}', but there is no metamodel with that name` });
      continue;
    }
    const missing = g.requires.filter(req => !enabled.has(req));
    for (const req of missing) {
      problems.push({ metamodel: name, missing: req, message: `'${name}' needs '${req}': add '${req}' to this project` });
    }
    if (missing.length) {
      // the reason a metamodel cannot be used names everything that is missing, not just the last one
      const list = missing.map(m => `'${m}'`).join(', ');
      unavailable.set(name, `'${name}' needs ${list}: add ${list} to this project`);
    }
  }
  return { problems, unavailable };
}

/** What to select to satisfy every requirement: the selection plus everything it requires. */
export function suggestSelection(names: string[], grammars: GrammarInfo[]): string[] {
  const suggested = [...names];
  for (const name of names) {
    for (const req of grammars.find(i => i.name === name)?.requires ?? []) if (!suggested.includes(req)) suggested.push(req);
  }
  return suggested;
}

export const hasErrors = (g: GrammarInfo) => g.problems.some(p => p.severity === 'error');
