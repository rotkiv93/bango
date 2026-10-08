import { VISUALIZATION_TYPINGS } from '@bango/renderer';
import { useEffect, useState } from 'react';
import { CodeEditorView } from './CodeEditorView.js';
import { loadScriptIntelligence, useTypings } from './script-intelligence.js';
import { bango, useWorkspace } from './store.js';

/**
 * The editor of a metamodel's constraints or JSON mapping. Once Monaco's TypeScript service has loaded, it knows the AST types of
 * the metamodel (from its grammar), so `entity.` completes to the fields of an entity and a misspelled property is an error.
 * Until then (and if it cannot load) it is a plain editor.
 */
export function ScriptEditorView({ id, grammar, kind = 'script', value, onChange }: { id: string; grammar: string; /** `visualizations` are page code: they know what a view is given, not the AST types */ kind?: 'script' | 'visualizations'; value: string; onChange(value: string): void }) {
  const catalog = useWorkspace(s => s.catalog);
  const [ready, setReady] = useState(false);
  const [fetched, setFetched] = useState<string>();
  // a visualization is page code: what it is given is the same for every metamodel, not the AST types of this one
  const typings = kind === 'visualizations' ? VISUALIZATION_TYPINGS : fetched;

  useEffect(() => {
    let cancelled = false;
    loadScriptIntelligence().then(() => { if (!cancelled) setReady(true); }, () => { /* no language service: the plain editor stays */ });
    return () => { cancelled = true; };
  }, []);

  // the grammar changed (the catalog is rebuilt on every change): fetch its types again
  useEffect(() => {
    if (kind === 'visualizations') return;
    let cancelled = false;
    bango.getTypings(grammar).then(dts => { if (!cancelled) setFetched(dts); }, () => { /* keep the previous typings */ });
    return () => { cancelled = true; };
  }, [grammar, catalog, kind]);

  useEffect(() => {
    if (ready && typings !== undefined) void useTypings(typings);
  }, [ready, typings]);

  return <CodeEditorView id={id} language={ready ? 'javascript' : 'bango-js'} value={value} onChange={onChange} disposeModel />;
}
