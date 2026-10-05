import { useEffect, useRef } from 'react';
import { ModelRenderer, type ViewKind } from '@bango/renderer';
import { bango, useWorkspace } from './store.js';

/**
 * Shows one instance with a library renderer. The component only owns the lifecycle: all drawing,
 * editing and syncing is done by `ModelRenderer`, which talks to the engine in the worker.
 */
export function InstanceView({ metamodel, view, acceptReveal = true }: {
  metamodel: string;
  view: ViewKind;
  /** show source positions requested by other views (a diagram node, a form entry) in this pane */
  acceptReveal?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<ModelRenderer | undefined>(undefined);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const reveal = useWorkspace(s => s.reveal);
  const initialView = useRef(view);

  // one renderer per metamodel tab
  useEffect(() => {
    const r = new ModelRenderer(bango, { onReveal: (m, range) => useWorkspace.getState().revealInText(m, range) });
    renderer.current = r;
    ready.current = r.mount(host.current!, metamodel, initialView.current);
    return () => {
      void ready.current.then(() => r.dispose());
      renderer.current = undefined;
    };
  }, [metamodel]);

  // switching views keeps the same renderer (and the instance behind it)
  useEffect(() => {
    const r = renderer.current;
    if (r) void ready.current.then(() => r.setView(view));
  }, [view]);

  // a diagram node, form or AST entry asked to be shown in the text
  useEffect(() => {
    const r = renderer.current;
    if (acceptReveal && r && reveal && reveal.metamodel === metamodel) void ready.current.then(() => r.reveal(reveal.range));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  return <div ref={host} className="instance-host" />;
}
