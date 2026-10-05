/**
 * Default look of the built-in renderers (dark). Everything is driven by CSS variables read from any ancestor:
 * --bango-bg, -panel, -fg, -line, -input, -accent, -err, -warn, -ok, -key, -val, -num, -lit, -tint.
 * A page themes them by setting the variables, e.g. `.my-app { --bango-bg: white; --bango-fg: #222 }`.
 */
export const CSS = `
.bango-view { position: relative; box-sizing: border-box; width: 100%; height: 100%; overflow: auto; background: var(--bango-bg, #1e1e1e); color: var(--bango-fg, #d4d4d4);
  font: 13px/1.4 system-ui, sans-serif; }
.bango-view * { box-sizing: border-box; }
.bango-view-text { overflow: hidden; }
.bango-empty { padding: 16px; opacity: .7; }
.bango-pad { padding: 8px 12px; }
.bango-view button { cursor: pointer; background: var(--bango-input, #3c3c3c); color: inherit; border: 1px solid var(--bango-line, #3c3c3c); border-radius: 3px; padding: 1px 8px; font: inherit; }
.bango-view button.bango-link { background: none; border: 0; color: var(--bango-accent, #3794ff); padding: 0 4px; }
.bango-view button.bango-x { background: none; border: 0; color: var(--bango-err, #f48771); }

/* form */
.bango-form-error { color: var(--bango-err, #f48771); margin-bottom: 8px; }
.bango-node { border: 1px solid var(--bango-line, #3c3c3c); border-radius: 4px; margin: 6px 0; padding: 6px 10px; }
.bango-node.bango-depth1 { background: var(--bango-tint, #ffffff0a); }
.bango-node.bango-depth2 { background: var(--bango-tint, #ffffff14); }
.bango-node legend { padding: 0 6px; }
.bango-field { display: flex; gap: 8px; align-items: flex-start; padding: 2px 0; }
.bango-field > label { width: 120px; flex: none; opacity: .8; padding-top: 3px; }
.bango-values, .bango-children { flex: 1; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.bango-children { width: 100%; align-items: stretch; }
.bango-item { display: flex; gap: 4px; }
.bango-field input[type=text], .bango-field input[type=number], .bango-field select { background: var(--bango-input, #3c3c3c); color: inherit; border: 1px solid var(--bango-line, #555); padding: 2px 6px; border-radius: 3px; min-width: 180px; }
.bango-field .bango-invalid { border-color: var(--bango-err, #f48771); color: var(--bango-err, #f48771); }
.bango-add { display: flex; gap: 4px; flex-wrap: wrap; }

/* ast */
.bango-ast-toolbar { display: flex; gap: 4px; margin-bottom: 6px; }
.bango-ast-toolbar .bango-on { background: color-mix(in srgb, var(--bango-accent, #3794ff) 28%, transparent); }
.bango-ast-filename { font-weight: 600; margin: 8px 0 2px; color: var(--bango-key, #9cdcfe); }
.bango-ast-node > summary { cursor: pointer; padding: 1px 0; }
.bango-ast-body { margin-left: 14px; padding-left: 8px; border-left: 1px solid var(--bango-line, #3c3c3c); font-family: ui-monospace, monospace; font-size: 12px; }
.bango-key { color: var(--bango-key, #9cdcfe); }
.bango-val { color: var(--bango-val, #ce9178); }
.bango-dim { opacity: .55; }
.bango-ref.bango-unresolved { color: var(--bango-err, #f48771); }
.bango-json { margin: 0; font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
.bango-json-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; position: sticky; top: 0; background: var(--bango-bg, #1e1e1e); padding: 2px 0; }
.bango-json-toolbar select { background: var(--bango-input, #3c3c3c); color: inherit; border: 1px solid var(--bango-line, #3c3c3c); border-radius: 3px; padding: 1px 4px; }
.bango-spacer { flex: 1; }
.bango-flag { display: inline-flex; align-items: center; gap: 2px; cursor: pointer; }
.bango-j-key { color: var(--bango-key, #9cdcfe); }
.bango-j-str { color: var(--bango-val, #ce9178); }
.bango-j-num { color: var(--bango-num, #b5cea8); }
.bango-j-lit { color: var(--bango-lit, #569cd6); }

/* diagram */
.bango-diagram { position: absolute; inset: 0; overflow: hidden; }
.bango-text-host { position: absolute; inset: 0; }
.bango-diagram svg { width: 100%; height: 100%; display: block; cursor: grab; }
.bango-diagram svg.bango-panning { cursor: grabbing; }
.bango-dnode { cursor: pointer; }
.bango-dnode text { fill: var(--bango-fg, #d4d4d4); font-size: 11px; pointer-events: none; }
.bango-dedge { fill: none; stroke-width: 1.5; }
.bango-dedge.bango-ref { stroke-dasharray: 5 4; }
.bango-legend { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 12px; font-size: 11px; background: var(--bango-panel, #252526); padding: 4px 8px; border-radius: 4px; }
`;

const STYLE_ID = 'bango-renderer-styles';

/** Adds the default styles once per document. */
export function injectStyles(doc: Document = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
