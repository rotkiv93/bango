import type { Problem, Range0 } from './types.js';

/** An LSP-style range (`line`/`character`, 0-based) as the plain `Range0`. */
export const toRange0 = (r: { start: { line: number; character: number }; end: { line: number; character: number } }): Range0 => ({
  startLine: r.start.line, startColumn: r.start.character, endLine: r.end.line, endColumn: r.end.character
});

/** The problems of one severity. */
export const problemsOf = (problems: Problem[], severity: Problem['severity']): Problem[] => problems.filter(p => p.severity === severity);

/** Just the messages of the problems of one severity. */
export const messagesOf = (problems: Problem[], severity: Problem['severity']): string[] => problemsOf(problems, severity).map(p => p.message);
