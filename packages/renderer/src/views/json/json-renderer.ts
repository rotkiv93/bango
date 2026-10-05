import type { InstanceState, JsonSpecOptions, JsonValue } from '@bango/engine';
import { clear, h } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';

/** Pretty-printed JSON text. */
export const formatJson = (value: JsonValue | undefined, indent = 2): string => JSON.stringify(value, null, indent) ?? '';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** JSON text as DOM with syntax classes (keys, strings, numbers, literals) so it reads well without any library. */
export function highlightJson(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      out.appendChild(h('span', { class: m[2] ? 'bango-j-key' : 'bango-j-str' }, m[1]));
      if (m[2]) out.appendChild(document.createTextNode(m[2]));
    } else {
      out.appendChild(h('span', { class: m[3] ? 'bango-j-lit' : 'bango-j-num' }, m[0]));
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
  return out;
}

/**
 * The JSON of an instance, or of the whole project, as readable text.
 *
 * `Mapping` is the metamodel's own JSON mapping: one piece of the product specification per metamodel, and for the
 * project all pieces merged into one document (or listed one per metamodel). `Generic tree` is the same shape for
 * every metamodel, with options for how references are written, `$type` and source positions.
 * Copy it or download it.
 */
export class JsonRenderer implements InstanceRenderer {
  private root!: HTMLElement;
  private body!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private options: JsonSpecOptions = { format: 'spec', merge: true, refs: 'detailed', types: true, ranges: false };
  private text = '';
  private message?: string;
  private seq = 0;
  private latest?: InstanceState;

  constructor(private ctx: RenderContext, private scope: 'instance' | 'project') {}

  mount(el: HTMLElement) {
    this.root = h('div', { class: 'bango-pad bango-json-view' });
    this.body = h('pre', { class: 'bango-json' });
    this.toolbarEl = this.toolbar();
    this.root.append(this.toolbarEl, this.body);
    el.appendChild(this.root);
  }

  async update(state: InstanceState) {
    this.latest = state;
    const seq = ++this.seq;
    const { engine } = this.ctx;
    let value: JsonValue | undefined;
    let message: string | undefined;

    try {
      if (this.scope === 'instance') {
        value = await engine.toJson(this.ctx.metamodel, this.options);
        if (value === undefined) message = state.problems[0]?.message ?? 'No instance to show';
      } else {
        value = await engine.toProjectJson(this.options);
        if (value && typeof value === 'object' && !Object.keys(value).length) {
          message = this.options.format !== 'generic' && this.options.merge !== false
            ? 'Nothing to merge yet: no instance of a metamodel with a JSON mapping'
            : 'The project has no instances to show';
        }
      }
    } catch (e) {
      // a mapping that fails, or specs that cannot be merged: say why instead of showing nothing
      message = (e as Error).message;
    }
    if (seq !== this.seq) return;
    this.message = message;
    this.text = message ? '' : formatJson(value);
    this.render();
  }

  dispose() {
    this.seq++;
    this.root?.remove();
  }

  /** the JSON currently shown */
  get json(): string {
    return this.text;
  }

  private render() {
    clear(this.body);
    if (this.message) this.body.appendChild(h('span', { class: 'bango-dim' }, this.message));
    else this.body.appendChild(highlightJson(this.text));
  }

  private change(patch: JsonSpecOptions) {
    this.options = { ...this.options, ...patch };
    const next = this.toolbar();
    this.toolbarEl.replaceWith(next);
    this.toolbarEl = next;
    if (this.latest) void this.update(this.latest);
  }

  private toolbar(): HTMLElement {
    const o = this.options;
    const select = (value: string, items: [string, string][], onChange: (v: string) => void) =>
      h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
        ...items.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    const flag = (label: string, key: 'types' | 'ranges', on: boolean) =>
      h('label', { class: 'bango-flag' },
        h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => this.change({ [key]: (e.target as HTMLInputElement).checked }) }), ` ${label}`);

    const generic = o.format === 'generic';
    return h('div', { class: 'bango-json-toolbar' },
      select(o.format ?? 'spec', [['spec', 'Mapping (spec)'], ['generic', 'Generic tree']], v => this.change({ format: v as 'spec' | 'generic' })),
      // the merged document only exists for mappings: the generic trees of different metamodels cannot be merged
      this.scope === 'project' && !generic && select(o.merge === false ? 'split' : 'merged', [['merged', 'Merged document'], ['split', 'One per metamodel']], v => this.change({ merge: v === 'merged' })),
      generic && select(o.refs ?? 'detailed', [['detailed', 'References: detailed'], ['names', 'References: names only']], v => this.change({ refs: v as 'detailed' | 'names' })),
      generic && flag('$type', 'types', o.types !== false),
      generic && flag('positions', 'ranges', !!o.ranges),
      h('span', { class: 'bango-spacer' }),
      h('button', { onclick: () => void navigator.clipboard?.writeText(this.text) }, 'Copy'),
      h('button', { onclick: () => this.download() }, 'Download'));
  }

  private download() {
    const url = URL.createObjectURL(new Blob([this.text], { type: 'application/json' }));
    const a = h('a', { href: url, download: `${this.scope === 'project' ? 'project' : this.ctx.metamodel}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }
}
