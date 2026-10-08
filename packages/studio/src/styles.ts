/** The studio's stylesheet. It follows the renderer's `--bango-*` variables, so a page that themes the views themes the studio. */
export const CSS = `
.bs { --bs-bg: var(--bango-bg, #1e1e1e); --bs-panel: var(--bango-panel, #252526); --bs-fg: var(--bango-fg, #d4d4d4); --bs-line: var(--bango-line, #3c3c3c);
  --bs-accent: var(--bango-accent, #3794ff); --bs-err: var(--bango-err, #f14c4c); --bs-warn: #cca700; --bs-ok: #4ec9b0; --bs-tint: var(--bango-tint, #2a2d2e);
  display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bs-bg); color: var(--bs-fg); font: 13px/1.4 system-ui, sans-serif; }
.bs * { box-sizing: border-box; }
.bs-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 4px 8px; border-bottom: 1px solid var(--bs-line); background: var(--bs-panel); }
.bs-tabs { display: flex; flex-wrap: wrap; gap: 2px; }
.bs-tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 5px 10px; color: inherit; font: inherit; cursor: pointer; opacity: .75; }
.bs-tab:hover { opacity: 1; }
.bs-tab[aria-selected="true"] { opacity: 1; border-bottom-color: var(--bs-accent); }
.bs-tab .bs-count { margin-left: 4px; font-size: 11px; opacity: .8; }
.bs-spacer { flex: 1; }
.bs-status { font-size: 12px; padding: 1px 6px; border-radius: 9px; }
.bs-status.err { color: var(--bs-err); } .bs-status.ok { color: var(--bs-ok); } .bs-status.warn { color: var(--bs-warn); }
.bs-body { position: relative; flex: 1; min-height: 0; }
.bs-panel { position: absolute; inset: 0; display: none; flex-direction: column; min-height: 0; }
.bs-panel.on { display: flex; }
.bs-panel > .bs-host { flex: 1; min-height: 0; position: relative; }
.bs-scroll { overflow: auto; padding: 12px 16px; }
.bs-empty { padding: 32px 16px; text-align: center; opacity: .75; }
.bs-empty p { margin: 6px auto 0; max-width: 60ch; }
.bs-problems { border-top: 1px solid var(--bs-line); background: var(--bs-panel); max-height: 30%; overflow: auto; }
.bs-problems-head { display: flex; gap: 10px; align-items: center; width: 100%; padding: 4px 10px; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.bs-problems ul { list-style: none; margin: 0; padding: 0 0 4px; }
.bs-problems li button { display: block; width: 100%; padding: 2px 14px; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.bs-problems li button:hover { background: var(--bs-tint); }
.bs-problems li.error .pos { color: var(--bs-err); } .bs-problems li.warning .pos { color: var(--bs-warn); }
.bs-problems .pos { font-family: ui-monospace, monospace; margin-right: 6px; opacity: .85; }
.bs-toolbar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--bs-line); }
.bs-seg { display: inline-flex; border: 1px solid var(--bs-line); border-radius: 4px; overflow: hidden; }
.bs-seg button { background: none; border: 0; border-right: 1px solid var(--bs-line); padding: 3px 10px; color: inherit; font: inherit; cursor: pointer; }
.bs-seg button:last-child { border-right: 0; }
.bs-seg button[aria-pressed="true"] { background: var(--bs-accent); color: #fff; }
.bs button.bs-btn { background: var(--bs-tint); border: 1px solid var(--bs-line); border-radius: 4px; color: inherit; font: inherit; padding: 3px 10px; cursor: pointer; }
.bs button.bs-btn.primary { background: var(--bs-accent); border-color: var(--bs-accent); color: #fff; }
.bs button.bs-btn:disabled { opacity: .5; cursor: default; }
.bs select, .bs input[type=text], .bs textarea { background: var(--bango-input, #3c3c3c); color: inherit; border: 1px solid var(--bs-line); border-radius: 3px; font: inherit; padding: 3px 6px; }
.bs textarea { width: 100%; font-family: ui-monospace, monospace; resize: vertical; }
.bs-case { border: 1px solid var(--bs-line); border-left-width: 4px; border-radius: 4px; margin: 10px 0; padding: 8px 10px; background: var(--bs-panel); }
.bs-case.pass { border-left-color: var(--bs-ok); } .bs-case.fail { border-left-color: var(--bs-err); }
.bs-case-head { display: flex; align-items: center; gap: 8px; }
.bs-case-head input { flex: 1; }
.bs-case-body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
@media (max-width: 800px) { .bs-case-body { grid-template-columns: 1fr; } }
.bs-field { display: flex; flex-direction: column; gap: 3px; margin: 4px 0; }
.bs-field > span { font-size: 12px; opacity: .8; }
.bs-failures { margin: 6px 0 0; padding-left: 18px; color: var(--bs-err); }
.bs-banner { padding: 6px 10px; margin: 8px 0; border-radius: 4px; background: rgba(241, 76, 76, .15); color: var(--bs-err); }
.bs-muted { opacity: .7; }
.bs-view { position: absolute; inset: 0; }
`;

const ID = 'bango-studio-styles';

/** Adds the stylesheet to the document once. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(ID)) return;
  const style = doc.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
