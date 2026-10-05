import type { ModelComposer } from '@bango/composer';
import { messagesOf, type CaseResult, type MetamodelCase } from '@bango/core';
import { ModelEngine } from './engine.js';

/** `expected` pieces against the `found` messages, one to one: what is missing, and what was not expected. */
function compare(kind: string, expected: string[], found: string[]): string[] {
  const unmatched = [...found];
  const failures: string[] = [];
  for (const piece of expected) {
    const at = unmatched.findIndex(m => m.includes(piece));
    if (at < 0) failures.push(`expected ${kind} containing "${piece}", but there is none`);
    else unmatched.splice(at, 1);
  }
  for (const m of unmatched) failures.push(`unexpected ${kind}: ${m}`);
  return failures;
}

/**
 * Runs sample instances of one metamodel. The metamodel is composed with everything it requires, in an engine of its own, so the
 * composition and instances the caller is working with are not disturbed.
 */
export async function runCases(composer: ModelComposer, metamodel: string, cases: MetamodelCase[]): Promise<CaseResult[]> {
  const check = await composer.check([metamodel]);
  // requirements are not an obstacle: the samples run with the metamodels the grammar needs
  const selection = check.suggested;
  const composition = await composer.compose(selection);
  const unavailable = composition.explainUnavailable(metamodel);
  if (unavailable) return cases.map(c => ({ name: c.name, ok: false, failures: [unavailable], problems: [] }));

  const engine = new ModelEngine();
  await engine.use(composition);
  const results: CaseResult[] = [];
  for (const c of cases) {
    await engine.setInstances({ ...c.with, [metamodel]: c.text });
    const { problems } = await engine.getInstance(metamodel);
    const failures = [
      ...compare('error', c.expect.errors ?? [], messagesOf(problems, 'error')),
      ...(c.expect.warnings ? compare('warning', c.expect.warnings, messagesOf(problems, 'warning')) : [])
    ];
    results.push({ name: c.name, ok: failures.length === 0, failures, problems });
  }
  engine.dispose();
  return results;
}
