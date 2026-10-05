import { useEffect, useState } from 'react';
import type { InstanceState } from '@bango/core';
import type { ViewKind } from '@bango/renderer';
import { InstanceView } from './InstanceView.js';
import { MetamodelPicker, SelectionVerdict, useSelectionCheck } from './MetamodelPicker.js';
import { ProblemList } from './ProblemList.js';
import { useWorkspace, type OverviewView } from './store.js';
import { Banner, Chip, Dialog, EmptyState, Segmented, Status } from './ui.js';

const VIEWS: { value: ViewKind; label: string; title: string }[] = [
  { value: 'text', label: 'Text', title: 'Write the instance in its own syntax' },
  { value: 'form', label: 'Form', title: 'Edit it with a form generated from the grammar' },
  { value: 'diagram', label: 'Diagram', title: 'See the whole project as a diagram' },
  { value: 'json', label: 'JSON', title: 'The instance as a JSON spec' },
  { value: 'ast', label: 'AST', title: 'The parsed tree, with resolved references' }
];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- manage metamodels

function ManageDialog({ onClose }: { onClose(): void }) {
  const project = useWorkspace(s => (s.activeProject ? s.workspace.projects[s.activeProject] : undefined))!;
  const setProjectMetamodels = useWorkspace(s => s.setProjectMetamodels);
  const toast = useWorkspace(s => s.toast);
  const [selected, setSelected] = useState(project.metamodels);
  const [errors, setErrors] = useState<string[]>([]);
  const check = useSelectionCheck(selected);
  const dropped = project.metamodels.filter(m => !selected.includes(m) && project.instances[m] !== undefined);

  const apply = async () => {
    const result = await setProjectMetamodels(selected);
    if (result.ok) { toast('success', 'Metamodels updated'); onClose(); } else setErrors(result.errors);
  };

  return (
    <Dialog
      title={`Metamodels of ${project.name}`}
      onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => void apply()}>Apply</button></>}
    >
      <MetamodelPicker selected={selected} onChange={s => { setSelected(s); setErrors([]); }} />
      <SelectionVerdict check={check} show selected={selected} onChange={s => { setSelected(s); setErrors([]); }} extraErrors={errors.filter(e => !check?.errors.includes(e))} />
      {dropped.length > 0 && <Banner tone="warn">The instances of {dropped.join(', ')} are kept, but they will not be part of the project until the metamodel is selected again.</Banner>}
    </Dialog>
  );
}

// ----------------------------------------------------------------------- overview

function Overview() {
  const s = useWorkspace();
  const project = s.workspace.projects[s.activeProject!];
  const build = s.build && s.build.project === s.activeProject ? s.build.result : undefined;
  const [showModel, setShowModel] = useState(false);
  const host = project.metamodels[0];
  const grammar = (name: string) => s.catalog.find(g => g.name === name);

  return (
    <div className="overview">
      {s.composition?.problems.map((p, i) => (
        <Banner key={i} tone="err" actions={<button onClick={() => void s.setProjectMetamodels([...project.metamodels, p.missing])}>Add '{p.missing}'</button>}>{p.message}</Banner>
      ))}

      {s.composition && s.composition.renames.length > 0 && (
        <Banner tone="info">
          <strong>Some type names clash between the metamodels of this project</strong>, so the composer renamed them here:
          <ul>
            {s.composition.renames.map(r => (
              <li key={`${r.file}.${r.original}`}>
                <code>{r.file}</code>'s <code>{r.original}</code> is called <code>{r.renamed}</code> ({r.keeper} keeps <code>{r.original}</code>)
              </li>
            ))}
          </ul>
          Instances are written the same way; only type names change. In constraints and JSON mappings use <code>typeName(node)</code> for the name the author wrote.
        </Banner>
      )}

      <div className="cards">
        {project.metamodels.map(m => {
          const inst = s.instances.find(i => i.metamodel === m);
          const g = grammar(m);
          return (
            <article key={m} className="card" onClick={() => s.selectTab(m)}>
              <div className="card-head"><h3>{m}</h3><Status none={!inst} problems={inst?.problems} /></div>
              <p className="muted">{g?.description ?? ''}</p>
              <div className="card-foot">
                {inst
                  ? <button onClick={e => { e.stopPropagation(); s.selectTab(m); }}>Open</button>
                  : <button className="primary" onClick={e => { e.stopPropagation(); void s.createInstance(m); }}>Create instance</button>}
                {inst?.stale && <Chip tone="warn" title="The grammar currently has errors; the last version that compiled is used">stale</Chip>}
              </div>
            </article>
          );
        })}
        {!project.metamodels.length && <EmptyState title="This project has no metamodels">Use “Manage metamodels” to choose some.</EmptyState>}
      </div>

      {build && (
        <Banner
          tone={build.ok ? 'ok' : 'err'}
          actions={build.ok && <>
            <button onClick={() => setShowModel(v => !v)}>{showModel ? 'Hide' : 'View'} model</button>
            <button onClick={() => download(`${build.model!.project}.json`, JSON.stringify(build.model!.spec, null, 2))} title="The merged JSON specification of the project">Download JSON spec</button>
            <button onClick={() => download(`${build.model!.project}.model.json`, JSON.stringify(build.model, null, 2))}>Download model</button>
          </>}
        >
          <strong>{build.ok ? `Build succeeded: ${build.model!.instances.length} instance(s) in ${build.model!.metamodels.length} metamodel(s)` : `Build failed: ${build.errors.length} error(s)`}</strong>
          {build.errors.length > 0 && <ul className="build-errors">{build.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {build.warnings.length > 0 && <ul className="build-warnings">{build.warnings.map((e, i) => <li key={i}>⚠ {e}</li>)}</ul>}
          {build.ok && showModel && <pre className="model-json">{JSON.stringify(build.model, null, 2)}</pre>}
        </Banner>
      )}

      {host && (
        <section className="project-views">
          <div className="section-head">
            <h2>The whole project</h2>
            <Segmented<OverviewView>
              small
              value={s.overviewView}
              onChange={s.setOverviewView}
              items={[{ value: 'diagram', label: 'Diagram' }, { value: 'project-json', label: 'JSON' }, { value: 'project-ast', label: 'AST' }]}
            />
          </div>
          <div className="view-area"><InstanceView metamodel={host} view={s.overviewView} /></div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one metamodel

function MetamodelWorkspace({ metamodel }: { metamodel: string }) {
  const s = useWorkspace();
  const inst: InstanceState | undefined = s.instances.find(i => i.metamodel === metamodel);
  const blocked = s.composition?.problems.find(p => p.metamodel === metamodel);
  const g = s.catalog.find(x => x.name === metamodel);
  // beside the text, a view of the same instance; the text itself cannot be its own neighbour
  const side: ViewKind = s.instanceView === 'text' ? 'form' : s.instanceView;

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) outside the text editors, which have their own history
  const { undo, redo } = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as Element | null)?.closest?.('.monaco-editor, input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); void undo(metamodel); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); void redo(metamodel); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [metamodel, undo, redo]);

  if (!inst) {
    return (
      <EmptyState
        title={`No ${metamodel} instance yet`}
        action={blocked ? undefined : <button className="primary" onClick={() => void s.createInstance(metamodel)}>Create {metamodel} instance</button>}
      >
        {blocked ? blocked.message : (g?.description ?? 'Start from the smallest valid instance and build on it.')}
      </EmptyState>
    );
  }

  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="title">
          <h2>{metamodel}</h2>
          <Status problems={inst.problems} />
          {inst.stale && <Chip tone="warn">stale</Chip>}
          {!inst.available && <Chip tone="err">not available</Chip>}
        </div>
        <div className="tools">
          <span className="history">
            <button className="icon" disabled={!inst.canUndo} title="Undo the last change (Ctrl+Z)" aria-label="Undo" onClick={() => void s.undo(metamodel)}>↶</button>
            <button className="icon" disabled={!inst.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => void s.redo(metamodel)}>↷</button>
          </span>
          <Segmented<ViewKind> value={s.split && s.instanceView === 'text' ? 'form' : s.instanceView} items={VIEWS} onChange={s.setInstanceView} />
          <label className="toggle" title="Show the text next to the view">
            <input type="checkbox" checked={s.split} onChange={e => s.setSplit(e.target.checked)} /> Split with text
          </label>
        </div>
      </div>
      <div className={`view-area${s.split ? ' split' : ''}`}>
        {s.split ? (
          <>
            <div className="pane"><InstanceView key={`${metamodel}-text`} metamodel={metamodel} view="text" /></div>
            <div className="pane"><InstanceView key={`${metamodel}-side`} metamodel={metamodel} view={side} acceptReveal={false} /></div>
          </>
        ) : (
          <InstanceView key={metamodel} metamodel={metamodel} view={s.instanceView} />
        )}
      </div>
      <div className="footer">
        <ProblemList problems={inst.problems} metamodel={metamodel} />
        <button className="danger-text" onClick={() => { if (window.confirm(`Remove the ${metamodel} instance?`)) void s.removeInstance(metamodel); }}>Remove instance</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- the page

export function ProjectPage() {
  const s = useWorkspace();
  const [managing, setManaging] = useState(false);
  const project = s.activeProject ? s.workspace.projects[s.activeProject] : undefined;

  if (!project) {
    return (
      <div className="page">
        <EmptyState title="No project open" action={<button className="primary" onClick={() => s.go('projects')}>Choose a project</button>}>
          Open one from the Projects page, or create a new one.
        </EmptyState>
      </div>
    );
  }

  // one tab per metamodel of the project, plus instances left over from a metamodel that was deselected
  const tabs = [...new Set([...project.metamodels, ...s.instances.map(i => i.metamodel)])];

  return (
    <div className="page project">
      <div className="project-head">
        <div className="project-title">
          <h1>{project.name}</h1>
          <div className="chips">{project.metamodels.map(m => <Chip key={m} tone="accent">{m}</Chip>)}</div>
          <button className="link" onClick={() => setManaging(true)}>Manage metamodels</button>
        </div>
        <button className="primary large" disabled={s.building} onClick={() => void s.buildProject()}>{s.building ? 'Building…' : 'Build model'}</button>
      </div>

      <nav className="tabbar" role="tablist">
        <button role="tab" aria-selected={s.activeTab === 'overview'} className={s.activeTab === 'overview' ? 'on' : ''} onClick={() => s.selectTab('overview')}>Overview</button>
        {tabs.map(m => {
          const inst = s.instances.find(i => i.metamodel === m);
          return (
            <button key={m} role="tab" aria-selected={s.activeTab === m} className={s.activeTab === m ? 'on' : ''} onClick={() => s.selectTab(m)}>
              {m} <Status none={!inst} problems={inst?.problems} />
            </button>
          );
        })}
      </nav>

      <div className="tabbody">
        {s.activeTab === 'overview' ? <Overview /> : <MetamodelWorkspace metamodel={s.activeTab} />}
      </div>

      {managing && <ManageDialog onClose={() => setManaging(false)} />}
    </div>
  );
}
