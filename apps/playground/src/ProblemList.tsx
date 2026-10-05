import { problemsOf, type Problem } from '@bango/core';
import { useState } from 'react';
import { useWorkspace } from './store.js';

/** Problems of an instance, collapsible. Clicking one shows its position in the text. */
export function ProblemList({ problems, metamodel }: { problems: Problem[]; metamodel?: string }) {
  const reveal = useWorkspace(s => s.revealInText);
  const [open, setOpen] = useState(true);
  const errors = problemsOf(problems, 'error').length;
  const warnings = problemsOf(problems, 'warning').length;

  if (!problems.length) return <div className="problems ok">✓ No problems</div>;
  return (
    <div className="problems">
      <button className="problems-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} Problems</span>
        {errors > 0 && <span className="status err">✖ {errors}</span>}
        {warnings > 0 && <span className="status warn">⚠ {warnings}</span>}
      </button>
      {open && (
        <ul>
          {problems.map((p, i) => (
            <li key={i} className={p.severity}>
              <button
                disabled={!metamodel}
                onClick={() => metamodel && reveal(metamodel, { startLine: p.startLine, startColumn: p.startColumn, endLine: p.endLine, endColumn: p.endColumn })}
              >
                <span className="pos">{p.startLine + 1}:{p.startColumn + 1}</span> {p.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
