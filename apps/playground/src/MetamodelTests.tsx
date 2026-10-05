import { useEffect, useState } from 'react';
import { messagesOf, type CaseResult, type MetamodelCase } from '@bango/core';
import { bango, useWorkspace } from './store.js';
import { EmptyState } from './ui.js';

const NO_CASES: MetamodelCase[] = [];

const toLines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean);
const fromLines = (lines: string[] | undefined) => (lines ?? []).join('\n');

/** Sample instances of a metamodel and what they must report: tests for its grammar and constraints. They rerun as the metamodel changes. */
export function MetamodelTests({ name, requires }: { name: string; requires: string[] }) {
  const cases = useWorkspace(s => s.workspace.cases[name]) ?? NO_CASES;
  const catalog = useWorkspace(s => s.catalog);
  const projectText = useWorkspace(s => s.instances.find(i => i.metamodel === name)?.text);
  const setCases = useWorkspace(s => s.setCases);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [failure, setFailure] = useState<string>();

  // the catalog changes whenever a grammar, constraints or mapping was pushed to the worker
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await bango.runCases(name, cases);
        if (!cancelled) { setResults(found); setFailure(undefined); }
      } catch (e) {
        if (!cancelled) setFailure((e as Error).message);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [name, cases, catalog]);

  const update = (index: number, patch: Partial<MetamodelCase>) => setCases(name, cases.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const updateExpect = (index: number, patch: Partial<MetamodelCase['expect']>) => update(index, { expect: { ...cases[index].expect, ...patch } });
  const add = () => setCases(name, [...cases, { name: `case ${cases.length + 1}`, text: projectText ?? '', expect: {} }]);
  const passed = results.filter(r => r.ok).length;

  return (
    <div className="tests">
      <div className="tests-head">
        <div>
          <strong>{cases.length ? `${passed} of ${cases.length} passing` : 'No test cases yet'}</strong>
          <span className="muted"> A case is a sample instance and the errors it must report. They rerun when the metamodel changes.</span>
        </div>
        <button className="primary" onClick={add}>+ Add case{projectText ? ' from the open project' : ''}</button>
      </div>
      {failure && <div className="banner err" role="alert">{failure}</div>}
      {!cases.length && <EmptyState title="Test this metamodel">Add a sample instance, say what it must report, and keep editing the grammar and constraints with that safety net.</EmptyState>}
      {cases.map((c, i) => {
        const result: CaseResult | undefined = results[i];
        return (
          <div key={i} className={`case${result ? (result.ok ? ' pass' : ' fail') : ''}`}>
            <div className="case-head">
              <span className={`status ${result ? (result.ok ? 'ok' : 'err') : 'none'}`} title={result ? (result.ok ? 'Passing' : 'Failing') : 'Not run yet'}>{result ? (result.ok ? '✓' : '✖') : '…'}</span>
              <input value={c.name} aria-label="Case name" onChange={e => update(i, { name: e.target.value })} />
              <button className="icon danger" title="Remove this case" aria-label="Remove this case" onClick={() => setCases(name, cases.filter((_, j) => j !== i))}>×</button>
            </div>
            {result && !result.ok && <ul className="case-failures">{result.failures.map((f, k) => <li key={k}>{f}</li>)}</ul>}
            <div className="case-body">
              <label className="field"><span>Instance</span>
                <textarea value={c.text} spellCheck={false} rows={Math.max(4, c.text.split('\n').length)} onChange={e => update(i, { text: e.target.value })} />
              </label>
              <div className="case-expect">
                <label className="field"><span>Errors it must report <small className="muted">one per line, a piece of the message is enough</small></span>
                  <textarea value={fromLines(c.expect.errors)} spellCheck={false} rows={3} onChange={e => updateExpect(i, { errors: toLines(e.target.value) })} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={c.expect.warnings !== undefined} onChange={e => updateExpect(i, { warnings: e.target.checked ? [] : undefined })} /> Check warnings too
                </label>
                {c.expect.warnings !== undefined && (
                  <textarea value={fromLines(c.expect.warnings)} aria-label="Warnings it must report" spellCheck={false} rows={2} onChange={e => updateExpect(i, { warnings: toLines(e.target.value) })} />
                )}
                {result && !result.ok && (
                  <button title="Set the expectations to what this instance reports now" onClick={() => update(i, { expect: { errors: messagesOf(result.problems, 'error'), ...(c.expect.warnings ? { warnings: messagesOf(result.problems, 'warning') } : {}) } })}>
                    Expect what it reports
                  </button>
                )}
              </div>
            </div>
            {requires.length > 0 && (
              <details className="case-with" open={!!c.with && Object.keys(c.with).length > 0}>
                <summary>Instances of the metamodels it needs ({requires.join(', ')})</summary>
                {requires.map(r => (
                  <label key={r} className="field"><span>{r}</span>
                    <textarea value={c.with?.[r] ?? ''} spellCheck={false} rows={4} onChange={e => update(i, { with: { ...c.with, [r]: e.target.value } })} />
                  </label>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
