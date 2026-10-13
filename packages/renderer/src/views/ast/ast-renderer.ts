import type { AstDto, InstanceAst, InstanceState, RefDto } from '@bango/core';
import { asArray, clear, h } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';

/** Tree (or raw JSON) view of one instance's AST, or of every instance of the project. Unresolved references show in red. */
export class AstRenderer implements InstanceRenderer {
  private root!: HTMLElement;
  private raw = false;
  private asts: InstanceAst[] = [];
  private seq = 0;

  constructor(private ctx: RenderContext, private scope: 'instance' | 'project') {}

  mount(el: HTMLElement) {
    this.root = h('div', { class: 'bango-pad bango-ast' });
    el.appendChild(this.root);
  }

  async update(state: InstanceState) {
    const seq = ++this.seq;
    const asts: InstanceAst[] =
      this.scope === 'instance'
        ? state.ast ? [{ metamodel: state.metamodel, ast: state.ast }] : []
        : (await this.ctx.engine.getInstances()).filter(i => i.ast).map(i => ({ metamodel: i.metamodel, ast: i.ast! }));
    if (seq !== this.seq) return;
    this.asts = asts;
    this.render();
  }

  dispose() {
    this.seq++;
    this.root?.remove();
  }

  private render() {
    clear(this.root);
    if (!this.asts.length) {
      this.root.appendChild(h('div', { class: 'bango-empty' }, 'Nothing to show yet.'));
      return;
    }
    const toolbar = h('div', { class: 'bango-ast-toolbar' },
      h('button', { class: this.raw ? '' : 'bango-on', onclick: () => { this.raw = false; this.render(); } }, 'Tree'),
      h('button', { class: this.raw ? 'bango-on' : '', onclick: () => { this.raw = true; this.render(); } }, 'JSON'),
      this.raw && h('button', { onclick: () => void navigator.clipboard?.writeText(JSON.stringify(this.asts, null, 2)) }, 'Copy')
    );
    this.root.appendChild(toolbar);
    if (this.raw) {
      this.root.appendChild(h('pre', { class: 'bango-json' }, JSON.stringify(this.asts, null, 2)));
      return;
    }
    for (const a of this.asts) {
      this.root.appendChild(h('div', { class: 'bango-ast-filename' }, a.metamodel));
      this.root.appendChild(this.node(a.metamodel, a.ast, undefined, 0));
    }
  }

  private refLines(feature: string, refs: RefDto | RefDto[]): HTMLElement[] {
    return asArray(refs).map(r =>
      h('div', { class: r.resolved ? 'bango-ref' : 'bango-ref bango-unresolved' },
        h('span', { class: 'bango-key' }, feature), ` → ${r.text} `,
        r.resolved
          ? h('span', { class: 'bango-dim' }, `(${r.targetType}${r.targetName ? ` ${r.targetName}` : ''} in ${r.targetMetamodel})`)
          : h('span', { class: 'bango-dim' }, 'unresolved')
      )
    );
  }

  private node(metamodel: string, node: AstDto, label: string | undefined, depth: number): HTMLElement {
    const summary = h('summary', {},
      label && h('span', { class: 'bango-key' }, label), label ? ' ' : '', h('b', {}, node.type), node.name ? ` ${node.name}` : '',
      node.range && h('button', {
        class: 'bango-link', title: 'Show in text',
        onclick: (e: Event) => { e.preventDefault(); this.ctx.reveal(metamodel, node.range!); }
      }, '↗')
    );
    const body = h('div', { class: 'bango-ast-body' });
    for (const [k, v] of Object.entries(node.props)) {
      body.appendChild(h('div', {}, h('span', { class: 'bango-key' }, k), ': ', h('span', { class: 'bango-val' }, JSON.stringify(v))));
    }
    for (const [k, r] of Object.entries(node.refs)) this.refLines(k, r).forEach(l => body.appendChild(l));
    for (const [k, c] of Object.entries(node.children)) {
      asArray(c).forEach((child, i) => body.appendChild(this.node(metamodel, child, Array.isArray(c) ? `${k}[${i}]` : k, depth + 1)));
    }
    const details = h('details', { class: 'bango-ast-node' }, summary, body);
    details.open = depth < 2;
    return details;
  }
}
