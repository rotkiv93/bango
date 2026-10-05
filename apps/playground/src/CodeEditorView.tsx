import { useEffect, useRef } from 'react';
import { CodeEditor } from '@bango/renderer/text';
import type { Problem } from '@bango/core';
import { monaco } from './monaco.js';

/** A metamodel (or constraints) editor: the library's `CodeEditor` bound to one text. */
export function CodeEditorView({ id, language, value, problems = [], onChange, readOnly, disposeModel }: {
  /** one Monaco model per id keeps undo history when switching tabs */
  id: string;
  language: 'langium' | 'bango-js' | 'javascript';
  value: string;
  problems?: Problem[];
  onChange?(value: string): void;
  readOnly?: boolean;
  /** drop the Monaco model when the editor goes away (scripts share one global scope in the TypeScript service, so they must not pile up) */
  disposeModel?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditor | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const ed = new CodeEditor(monaco, host.current!, {
      uri: `inmemory://bango/code/${id}`,
      language,
      value,
      onChange: t => onChangeRef.current?.(t),
      disposeModel,
      editorOptions: { readOnly: !!readOnly }
    });
    editor.current = ed;
    ed.setProblems(problems);
    return () => { ed.dispose(); editor.current = undefined; };
    // the editor is created per file; value and problems are synced by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, language, readOnly]);

  useEffect(() => editor.current?.setValue(value), [value]);
  useEffect(() => editor.current?.setProblems(problems), [problems]);

  return <div ref={host} className="instance-host" />;
}
