import { useEffect, useState } from 'react';
import { CodeEditorView } from './CodeEditorView.js';
import { loadScriptIntelligence, useTypings } from './script-intelligence.js';
import { bango, useWorkspace } from './store.js';

/**
 * The editor of a metamodel's constraints or JSON mapping. Once Monaco's TypeScript service has loaded, it knows the AST types of
 * the metamodel (from its grammar), so `entity.` completes to the fields of an entity and a misspelled property is an error.
 * Until then (and if it cannot load) it is a plain editor.
 */
export function ScriptEditorView({ id, grammar, value, onChange }: { id: string; grammar: string; value: string; onChange(value: string): void }) {
  const catalog = useWorkspace(s => s.catalog);
  const [ready, setReady] = useState(false);
  const [typings, setTypings] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadScriptIntelligence().then(() => { if (!cancelled) setReady(true); }, () => { /* no language service: the plain editor stays */ });
    return () => { cancelled = true; };
  }, []);

  // the grammar changed (the catalog is rebuilt on every change): fetch its types again
  useEffect(() => {
    let cancelled = false;
    bango.getTypings(grammar).then(dts => { if (!cancelled) setTypings(dts); }, () => { /* keep the previous typings */ });
    return () => { cancelled = true; };
  }, [grammar, catalog]);

  useEffect(() => {
    if (ready && typings !== undefined) void useTypings(typings);
  }, [ready, typings]);

  return <CodeEditorView id={id} language={ready ? 'javascript' : 'bango-js'} value={value} onChange={onChange} disposeModel />;
}
