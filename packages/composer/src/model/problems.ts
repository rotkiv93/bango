import type { LangiumDocument } from 'langium';
import type { Problem } from '@bango/core';

type LspDiagnostic = NonNullable<LangiumDocument['diagnostics']>[number];

const SEVERITY: Record<number, Problem['severity']> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

/** LSP diagnostic -> plain problem (0-based positions). */
export function toProblem(d: LspDiagnostic): Problem {
  const message: unknown = d.message;
  return {
    severity: SEVERITY[d.severity ?? 1] ?? 'error',
    message: typeof message === 'string' ? message : (message as { value: string }).value,
    startLine: d.range.start.line,
    startColumn: d.range.start.character,
    endLine: d.range.end.line,
    endColumn: d.range.end.character
  };
}

/** A problem about a whole document rather than a place in it. */
export const wholeFile = (severity: Problem['severity'], message: string): Problem => ({
  severity, message, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0
});
