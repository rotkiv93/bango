import { useEffect, useRef } from 'react';
import { AstRenderer, injectStyles } from '@bango/renderer';
import { bango, useWorkspace } from './store.js';

/** AST of a metamodel (the grammar itself), drawn with the library's AST renderer. */
export function GrammarAst({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<AstRenderer | undefined>(undefined);
  const composition = useWorkspace(s => s.composition);

  useEffect(() => {
    injectStyles();
    const r = new AstRenderer({ engine: bango, metamodel: name, reveal: () => undefined }, 'instance');
    r.mount(host.current!);
    renderer.current = r;
    return () => { r.dispose(); renderer.current = undefined; };
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    bango.getGrammarAst(name).then(ast => {
      if (!cancelled) void renderer.current?.update({ metamodel: name, text: '', ast, problems: [], stale: false, available: !!ast });
    });
    return () => { cancelled = true; };
  }, [name, composition]);

  return <div ref={host} className="bango-view" style={{ position: 'absolute', inset: 0 }} />;
}
