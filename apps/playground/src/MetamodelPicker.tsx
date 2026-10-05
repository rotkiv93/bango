import { useEffect, useState } from 'react';
import type { SelectionCheck } from '@bango/core';
import { useWorkspace } from './store.js';
import { Banner, Chip } from './ui.js';

/** The metamodels a project can choose from, as cards: what each is for, what it needs, whether it compiles. */
export function MetamodelPicker({ selected, onChange }: { selected: string[]; onChange(next: string[]): void }) {
  const catalog = useWorkspace(s => s.catalog).filter(g => g.extension);
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]);

  return (
    <div className="mm-grid" role="group" aria-label="Metamodels">
      {catalog.map(g => {
        const on = selected.includes(g.name);
        const errors = g.problems.filter(p => p.severity === 'error').length;
        const missing = g.requires.filter(r => !selected.includes(r));
        return (
          <label key={g.name} className={`mm-card${on ? ' on' : ''}${on && missing.length ? ' blocked' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => toggle(g.name)} />
            <div className="mm-body">
              <div className="mm-title">
                <strong>{g.name}</strong>
                <Chip>.{g.extension}</Chip>
                {errors > 0 && <Chip tone="err" title="The grammar has errors">✖ {errors}</Chip>}
              </div>
              <div className="mm-desc">{g.description ?? 'No description'}</div>
              {g.requires.length > 0 && (
                <div className="mm-needs">
                  needs {g.requires.map(r => <Chip key={r} tone={selected.includes(r) ? 'ok' : on ? 'err' : 'plain'}>{r}</Chip>)}
                </div>
              )}
            </div>
          </label>
        );
      })}
      {!catalog.length && <p className="muted">No metamodels yet. Create one on the Metamodels page.</p>}
    </div>
  );
}

/** Asks the composer whether the selection can be a project, as the user changes it. */
export function useSelectionCheck(selected: string[]) {
  const checkSelection = useWorkspace(s => s.checkSelection);
  const catalogVersion = useWorkspace(s => s.catalog);
  const [check, setCheck] = useState<SelectionCheck>();
  useEffect(() => {
    let cancelled = false;
    checkSelection(selected).then(c => { if (!cancelled) setCheck(c); });
    return () => { cancelled = true; };
    // the answer also depends on the grammars, which change `catalog`
  }, [selected.join('|'), catalogVersion, checkSelection]);
  return check;
}

/** The composer's verdict on a selection, with a button that applies its suggestion. */
export function SelectionVerdict({ check, show, selected, onChange, extraErrors = [] }: {
  check?: SelectionCheck;
  /** hide the "pick something" hint until the user tried to continue */
  show: boolean;
  selected: string[];
  onChange(next: string[]): void;
  extraErrors?: string[];
}) {
  const errors = [...extraErrors, ...(check && !check.ok && (show || selected.length) ? check.errors : [])];
  const unique = [...new Set(errors)];
  const canAdd = check && check.suggested.length > selected.length;
  if (!unique.length) {
    return selected.length && check?.ok ? <Banner tone="ok">These metamodels fit together.</Banner> : null;
  }
  return (
    <Banner
      tone="err"
      actions={canAdd && <button onClick={() => onChange(check!.suggested)}>Add what is missing</button>}
    >
      <strong>This combination cannot be a project</strong>
      <ul>{unique.map(e => <li key={e}>{e}</li>)}</ul>
    </Banner>
  );
}
