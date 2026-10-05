import { validateMetamodelName } from '@bango/engine/workspace';
import { useEffect, useState } from 'react';
import { CodeEditorView } from './CodeEditorView.js';
import { GrammarAst } from './GrammarAst.js';
import { MetamodelTests } from './MetamodelTests.js';
import { ScriptEditorView } from './ScriptEditorView.js';
import { ProblemList } from './ProblemList.js';
import { bango, useWorkspace, type MetamodelView } from './store.js';
import { Chip, Dialog, EmptyState, Segmented, Status } from './ui.js';

function NewMetamodelDialog({ onClose }: { onClose(): void }) {
  const addGrammar = useWorkspace(s => s.addGrammar);
  const existing = Object.keys(useWorkspace(s => s.workspace.grammars));
  const [name, setName] = useState('');
  const error = validateMetamodelName(name, existing);
  const valid = !error;
  const submit = () => { if (valid) { void addGrammar(name); onClose(); } };
  return (
    <Dialog
      title="New metamodel"
      onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!valid} onClick={submit}>Create</button></>}
    >
      <label className="field">
        <span>Name <small className="muted">lowercase letters and digits; it becomes the file extension of its instances</small></span>
        <input autoFocus value={name} placeholder="e.g. billing" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        {name && error && <small className="err">{error}</small>}
      </label>
      <p className="muted">It starts from a minimal grammar that imports the shared terminals. Import other metamodels to reference their types.</p>
    </Dialog>
  );
}

/** The composed grammar: the metamodel with every import inlined, as the composer produces it. */
function Composed({ name }: { name: string }) {
  const composition = useWorkspace(s => s.composition);
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    bango.bundleText(name).then(
      text => { if (!cancelled) setState({ text }); },
      e => { if (!cancelled) setState({ error: (e as Error).message }); }
    );
    return () => { cancelled = true; };
  }, [name, composition]);

  if (state.error) {
    return <EmptyState title="Not composed in the open project">{state.error}. Open a project that uses this metamodel to see its composed grammar.</EmptyState>;
  }
  return <CodeEditorView id={`composed/${name}`} language="langium" value={state.text ?? ''} readOnly />;
}

export function MetamodelsPage() {
  const s = useWorkspace();
  const [creating, setCreating] = useState(false);
  const names = Object.keys(s.workspace.grammars);
  const info = s.catalog.find(g => g.name === s.activeGrammar);
  const isMetamodel = !!info?.extension;
  const view: MetamodelView = isMetamodel ? s.metamodelView : 'grammar';

  return (
    <div className="page metamodels">
      <div className="page-head compact">
        <div>
          <h1>Metamodels</h1>
          <p className="lead">Langium grammars shared by every project. Edit one and the projects that use it revalidate immediately.</p>
        </div>
        <button className="primary large" onClick={() => setCreating(true)}>+ New metamodel</button>
      </div>

      <div className="split-page">
        <aside className="mm-list">
          {names.map(n => {
            const g = s.catalog.find(x => x.name === n);
            return (
              <button key={n} className={`mm-item${n === s.activeGrammar ? ' on' : ''}`} onClick={() => s.selectGrammar(n)}>
                <div className="mm-title">
                  <strong>{n}</strong>
                  {g?.extension ? <Chip>.{g.extension}</Chip> : <Chip tone="plain">library</Chip>}
                  <Status problems={g?.problems} />
                </div>
                <div className="mm-desc">{g?.description ?? ''}</div>
                {g && g.requires.length > 0 && <div className="mm-needs">needs {g.requires.join(', ')}</div>}
              </button>
            );
          })}
        </aside>

        <section className="mm-editor">
          {s.activeGrammar && info ? (
            <>
              <div className="toolbar">
                <div className="title"><h2>{s.activeGrammar}</h2>{info.extension && <Chip>.{info.extension}</Chip>}</div>
                {isMetamodel && (
                  <Segmented<MetamodelView>
                    value={view}
                    onChange={s.setMetamodelView}
                    items={[
                      { value: 'grammar', label: 'Grammar', title: 'The Langium grammar' },
                      { value: 'constraints', label: 'Constraints', title: 'Validation the grammar cannot express' },
                      { value: 'spec', label: 'JSON mapping', title: 'The piece of the JSON specification this metamodel owns' },
                      { value: 'import', label: 'JSON import', title: 'How the project JSON becomes an instance of this metamodel: the inverse of the JSON mapping' },
                      { value: 'tests', label: `Tests${(s.workspace.cases[s.activeGrammar]?.length ?? 0) ? ` (${s.workspace.cases[s.activeGrammar].length})` : ''}`, title: 'Sample instances and what they must report' },
                      { value: 'composed', label: 'Composed', title: 'The grammar with every import inlined' },
                      { value: 'ast', label: 'AST', title: 'The grammar as a tree' }
                    ]}
                  />
                )}
              </div>
              <div className="view-area">
                {view === 'grammar' && (
                  <CodeEditorView id={`grammar/${s.activeGrammar}`} language="langium" value={s.workspace.grammars[s.activeGrammar] ?? ''} problems={info.problems} onChange={t => s.editGrammar(s.activeGrammar!, t)} />
                )}
                {view === 'constraints' && (
                  <ScriptEditorView id={`constraints/${s.activeGrammar}`} grammar={s.activeGrammar} value={s.workspace.constraints[s.activeGrammar] ?? ''} onChange={t => s.editConstraints(s.activeGrammar!, t)} />
                )}
                {view === 'spec' && (
                  <ScriptEditorView id={`spec/${s.activeGrammar}`} grammar={s.activeGrammar} value={s.workspace.specs[s.activeGrammar] ?? ''} onChange={t => s.editSpec(s.activeGrammar!, t)} />
                )}
                {view === 'import' && (
                  <ScriptEditorView id={`import/${s.activeGrammar}`} grammar={s.activeGrammar} value={s.workspace.imports[s.activeGrammar] ?? ''} onChange={t => s.editImport(s.activeGrammar!, t)} />
                )}
                {view === 'tests' && <div className="scroll"><MetamodelTests name={s.activeGrammar} requires={info.requires} /></div>}
                {view === 'composed' && <Composed name={s.activeGrammar} />}
                {view === 'ast' && <GrammarAst name={s.activeGrammar} />}
              </div>
              <div className="footer"><ProblemList problems={info.problems} /></div>
            </>
          ) : (
            <EmptyState title="Select a metamodel">Pick one on the left to edit its grammar.</EmptyState>
          )}
        </section>
      </div>

      {creating && <NewMetamodelDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
