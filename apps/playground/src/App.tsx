import { useEffect, useState } from 'react';
import { MetamodelsPage } from './MetamodelsPage.js';
import { ProjectPage } from './ProjectPage.js';
import { ProjectsPage } from './ProjectsPage.js';
import { useWorkspace, type Page } from './store.js';
import { Banner } from './ui.js';
import './app.css';

function Header() {
  const s = useWorkspace();
  const nav: { page: Page; label: string }[] = [
    { page: 'projects', label: 'Projects' },
    { page: 'project', label: s.activeProject ? `Project: ${s.activeProject}` : 'Project' },
    { page: 'metamodels', label: 'Metamodels' }
  ];
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◆</span> Bango <small>metamodel playground</small></div>
      <nav>
        {nav.map(n => (
          <button
            key={n.page}
            className={s.page === n.page ? 'on' : ''}
            disabled={n.page === 'project' && !s.activeProject}
            onClick={() => s.go(n.page)}
          >{n.label}</button>
        ))}
      </nav>
      <span className="spacer" />
      <button className="icon" title={s.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} aria-label="Toggle theme" onClick={s.toggleTheme}>
        {s.theme === 'dark' ? '☀' : '☾'}
      </button>
      <button onClick={() => { if (window.confirm('Discard all changes and restore the examples?')) void s.reset(); }}>Reset examples</button>
    </header>
  );
}

/** Scripts that made the engine stop answering, and were switched off so that the rest keeps working. */
function Quarantine() {
  const quarantined = useWorkspace(s => s.quarantined);
  const reenable = useWorkspace(s => s.reenableScript);
  if (!quarantined.length) return null;
  const names = { constraints: 'constraints', spec: 'JSON mapping', import: 'import mapping' } as const;
  return (
    <div className="quarantine">
      <Banner tone="err">
        <strong>The engine stopped answering and was restarted.</strong> These scripts are probably in an endless loop, so they are switched off:
        <ul>
          {quarantined.map(q => (
            <li key={`${q.kind}:${q.metamodel}`}>
              the {names[q.kind]} of <code>{q.metamodel}</code> <button className="link" onClick={() => reenable(q.kind, q.metamodel)}>switch back on</button>
            </li>
          ))}
        </ul>
        Fix the script, or switch it on as it is: if the engine stops again it is switched off again.
      </Banner>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useWorkspace();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

export function App() {
  const s = useWorkspace();
  const [error, setError] = useState<string>();
  useEffect(() => { s.init().catch(e => setError(String(e))); }, []);

  if (error) return <pre className="fatal">{error}</pre>;
  if (!s.ready) return <div className="fatal">Compiling metamodels…</div>;

  return (
    <div className="app">
      <Header />
      <Quarantine />
      <main className="content">
        {s.page === 'projects' && <ProjectsPage />}
        {s.page === 'project' && <ProjectPage />}
        {s.page === 'metamodels' && <MetamodelsPage />}
      </main>
      <Toasts />
    </div>
  );
}
