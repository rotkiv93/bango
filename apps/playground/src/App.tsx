import { useEffect, useState } from 'react';
import { MetamodelsPage } from './MetamodelsPage.js';
import { ProjectPage } from './ProjectPage.js';
import { ProjectsPage } from './ProjectsPage.js';
import { useWorkspace, type Page } from './store.js';
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
      <main className="content">
        {s.page === 'projects' && <ProjectsPage />}
        {s.page === 'project' && <ProjectPage />}
        {s.page === 'metamodels' && <MetamodelsPage />}
      </main>
      <Toasts />
    </div>
  );
}
