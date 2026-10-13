import { validateProjectName } from '@bango/engine/workspace';
import { useState } from 'react';
import { MetamodelPicker, SelectionVerdict, useSelectionCheck } from './MetamodelPicker.js';
import { useWorkspace } from './store.js';
import { Chip, Dialog, EmptyState } from './ui.js';

function NewProjectDialog({ onClose }: { onClose(): void }) {
  const createProject = useWorkspace(s => s.createProject);
  const existing = Object.keys(useWorkspace(s => s.workspace.projects));
  const toast = useWorkspace(s => s.toast);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const check = useSelectionCheck(selected);

  const nameError = attempted ? validateProjectName(name, existing) : undefined;

  const submit = async () => {
    setAttempted(true);
    if (validateProjectName(name, existing)) return;
    setBusy(true);
    const result = await createProject(name.trim(), selected);
    setBusy(false);
    if (result.ok) {
      toast('success', `Project '${name.trim()}' created`);
      onClose();
    } else {
      setServerErrors(result.errors);
    }
  };

  return (
    <Dialog
      title="New project"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void submit()}>Create project</button>
      </>}
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="e.g. ship-monitoring" className={nameError ? 'invalid' : ''}
          onChange={e => { setName(e.target.value); setServerErrors([]); }}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }} />
        {nameError && <small className="err">{nameError}</small>}
      </label>

      <div className="field">
        <span>Metamodels <small className="muted">choose what the project is described with</small></span>
        <MetamodelPicker selected={selected} onChange={s => { setSelected(s); setServerErrors([]); }} />
      </div>

      <SelectionVerdict
        check={check}
        show={attempted}
        selected={selected}
        onChange={s => { setSelected(s); setServerErrors([]); }}
        extraErrors={serverErrors.filter(e => !check?.errors.includes(e))}
      />
    </Dialog>
  );
}

export function ProjectsPage() {
  const s = useWorkspace();
  const [creating, setCreating] = useState(false);
  const projects = Object.values(s.workspace.projects);
  const metamodels = s.catalog.filter(g => g.extension);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="lead">A project chooses the metamodels it is described with and holds one instance of each. The composer checks that the choice fits together.</p>
        </div>
        <button className="primary large" onClick={() => setCreating(true)}>+ New project</button>
      </div>

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" action={<button className="primary" onClick={() => setCreating(true)}>Create your first project</button>}>
          Pick the metamodels you need, for example the data model and the GIS model.
        </EmptyState>
      ) : (
        <div className="cards">
          {projects.map(p => (
            <article key={p.name} className="card project-card" onClick={() => void s.openProject(p.name)}>
              <div className="card-head">
                <h3>{p.name}</h3>
                <button
                  className="icon danger"
                  aria-label={`Delete ${p.name}`}
                  title="Delete project"
                  onClick={e => { e.stopPropagation(); if (window.confirm(`Delete project '${p.name}' and its instances?`)) void s.deleteProject(p.name); }}
                >🗑</button>
              </div>
              <div className="chips">{p.metamodels.length ? p.metamodels.map(m => <Chip key={m} tone="accent">{m}</Chip>) : <span className="muted">no metamodels</span>}</div>
              <p className="muted">{Object.keys(p.instances).length} of {p.metamodels.length} instance(s) defined</p>
              <button onClick={() => void s.openProject(p.name)}>Open</button>
            </article>
          ))}
        </div>
      )}

      <section className="catalog">
        <div className="section-head">
          <h2>Available metamodels</h2>
          <button className="link" onClick={() => s.go('metamodels')}>Edit metamodels →</button>
        </div>
        <div className="cards small">
          {metamodels.map(g => (
            <article key={g.name} className="card flat">
              <div className="card-head"><strong>{g.name}</strong><Chip>.{g.extension}</Chip></div>
              <p className="muted">{g.description ?? 'No description'}</p>
              {g.requires.length > 0 && <div className="chips">needs {g.requires.map(r => <Chip key={r}>{r}</Chip>)}</div>}
            </article>
          ))}
        </div>
      </section>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
