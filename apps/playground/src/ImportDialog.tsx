import { useEffect, useState } from 'react';
import { problemsOf, type ImportResult, type JsonValue } from '@bango/core';
import { useWorkspace } from './store.js';
import { Banner, Dialog, Status } from './ui.js';

/** Fill the instances of the open project from the JSON of a whole project: paste it, or load a file, and see what comes out before replacing anything. */
export function ImportDialog({ onClose }: { onClose(): void }) {
  const s = useWorkspace();
  const project = s.workspace.projects[s.activeProject!];
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResult(undefined);
    setParseError(undefined);
    if (!text.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let json: JsonValue;
      try { json = JSON.parse(text) as JsonValue; } catch (e) { setParseError(`This is not valid JSON: ${(e as Error).message}`); return; }
      setBusy(true);
      try {
        const found = await s.previewImport(json);
        if (!cancelled) setResult(found);
      } catch (e) {
        if (!cancelled) setParseError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // the preview depends on the text and on the metamodels' mappings, which only change while this dialog is closed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const replaced = result ? Object.keys(result.texts) : [];
  const apply = async () => {
    if (!result) return;
    await s.applyImport(result.texts);
    s.toast('success', `Imported ${replaced.length} instance(s)`);
    onClose();
  };

  return (
    <Dialog
      title={`Import JSON into ${project.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!replaced.length || busy} onClick={() => void apply()}>Replace {replaced.length || ''} instance{replaced.length === 1 ? '' : 's'}</button>
        </>
      }
    >
      <p className="muted">
        The JSON of a whole project (what <em>Download JSON spec</em> produces). Each metamodel that has an <strong>import mapping</strong> builds its own instance from it.
      </p>
      <label className="field">
        <span>JSON <small className="muted">paste it, or <input type="file" accept="application/json,.json" onChange={e => { void e.target.files?.[0]?.text().then(setText); }} /></small></span>
        <textarea className="import-json" value={text} rows={8} spellCheck={false} placeholder='{ "features": [ ... ], "data": { ... } }' onChange={e => setText(e.target.value)} />
      </label>
      {parseError && <Banner tone="err">{parseError}</Banner>}
      {busy && <p className="muted">Reading…</p>}
      {result && (
        <div className="import-result">
          {project.metamodels.map(m => {
            const problems = result.problems[m];
            const failure = result.errors.find(e => e.includes(`'${m}'`));
            return (
              <div key={m} className="import-row">
                <strong>{m}</strong>
                {result.texts[m] !== undefined && <><span className="muted">{result.texts[m].trim().split('\n').length} lines</span>{problems && <Status problems={problems} />}</>}
                {result.skipped.includes(m) && <span className="muted">no import mapping: its instance stays as it is</span>}
                {failure && <span className="err">{failure}</span>}
                {result.texts[m] !== undefined && problems && problemsOf(problems, 'error').length > 0 && <span className="err">{problemsOf(problems, 'error')[0].message}</span>}
              </div>
            );
          })}
          {replaced.length > 0 && <Banner tone="warn">This replaces the {replaced.join(', ')} instance{replaced.length === 1 ? '' : 's'} of the project.</Banner>}
        </div>
      )}
    </Dialog>
  );
}
