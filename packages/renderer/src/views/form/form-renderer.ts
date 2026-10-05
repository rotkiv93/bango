import type { AstDto, EditOp, FieldSchema, FormSchema, InstanceState, PathStep, RefCandidate, RefDto } from '@bango/engine';
import { asArray, clear, h } from '../../dom/dom.js';
import type { InstanceRenderer, RenderContext } from '../../host/types.js';

/**
 * Form editor generated from the grammar of the instance's metamodel.
 * Every change becomes an `EditOp` sent to the engine, which edits the text and re-parses it.
 */
export class FormRenderer implements InstanceRenderer {
  private root!: HTMLElement;
  private error?: string;
  private seq = 0;
  private data?: { ast: AstDto; schema: FormSchema; candidates: Record<string, RefCandidate[]> };
  private message?: string;

  constructor(private ctx: RenderContext) {}

  mount(el: HTMLElement) {
    this.root = h('div', { class: 'bango-pad bango-form' });
    el.appendChild(this.root);
  }

  async update(state: InstanceState) {
    const seq = ++this.seq;
    const { engine, metamodel } = this.ctx;
    if (!state.available || !state.ast) {
      this.data = undefined;
      this.message = state.problems[0]?.message ?? 'No instance';
      return this.render();
    }
    const schema = await engine.getFormSchema(metamodel);
    if (!schema) {
      this.data = undefined;
      this.message = `No form for '${metamodel}'`;
      return this.render();
    }
    const refTypes = new Set<string>();
    for (const t of Object.values(schema.types)) for (const f of t.fields) if (f.kind === 'ref' && f.refType) refTypes.add(f.refType);
    const entries = await Promise.all([...refTypes].map(async t => [t, await engine.getRefCandidates(t)] as const));
    if (seq !== this.seq) return; // a newer update is on its way
    this.data = { ast: state.ast, schema, candidates: Object.fromEntries(entries) };
    this.message = undefined;
    this.render();
  }

  dispose() {
    this.seq++;
    this.root?.remove();
  }

  // ------------------------------------------------------------------ editing

  private async edit(op: EditOp) {
    try {
      await this.ctx.engine.applyEdit(this.ctx.metamodel, op);
      this.error = undefined;
    } catch (e) {
      this.error = (e as Error).message;
      this.render();
    }
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    const scroll = this.root.scrollTop;
    clear(this.root);
    if (this.error) this.root.appendChild(h('div', { class: 'bango-form-error' }, this.error));
    if (!this.data) {
      this.root.appendChild(h('div', { class: 'bango-empty' }, this.message ?? ''));
      return;
    }
    this.root.appendChild(this.nodeForm(this.data.ast, [], 0));
    this.root.scrollTop = scroll;
  }

  private nodeForm(node: AstDto, path: PathStep[], depth: number): HTMLElement {
    const { metamodel, reveal } = this.ctx;
    const fields = this.data!.schema.types[node.type]?.fields ?? [];
    const legend = h('legend', {}, h('b', {}, node.type), node.name ? ` ${node.name}` : '',
      node.range && h('button', { class: 'bango-link', title: 'Show in text', onclick: () => reveal(metamodel, node.range!) }, '↗'),
      path.length > 0 && h('button', { class: 'bango-x', title: 'Delete', onclick: () => void this.edit({ kind: 'remove', path }) }, '🗑')
    );
    return h('fieldset', { class: `bango-node bango-depth${depth % 3}` }, legend, ...fields.map(f => this.field(node, f, path, depth)));
  }

  private field(node: AstDto, field: FieldSchema, path: PathStep[], depth: number): HTMLElement {
    const label = h('label', {}, `${field.name}${field.required ? ' *' : ''}`);
    const set = (value: string | number | boolean | null, index?: number) =>
      void this.edit({ kind: 'set', path, feature: field.name, index, value });

    if (field.kind === 'boolean') {
      const box = h('input', { type: 'checkbox', checked: node.props[field.name] === true, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
      return h('div', { class: 'bango-field' }, label, box);
    }

    if (field.kind === 'child') {
      const children = asArray(node.children[field.name]);
      const box = h('div', { class: 'bango-children' },
        ...children.map((child, i) => this.nodeForm(child, [...path, { feature: field.name, index: field.many ? i : undefined }], depth + 1))
      );
      const types = field.childTypes ?? [];
      if ((field.many || !children.length) && types.length) {
        box.appendChild(h('div', { class: 'bango-add' },
          ...types.map(t => h('button', { onclick: () => void this.edit({ kind: 'add', path, feature: field.name, type: t }) }, `+ ${t}`))));
      }
      return h('div', { class: 'bango-field' }, label, box);
    }

    const refs = field.kind === 'ref' ? asArray<RefDto>(node.refs[field.name]) : [];
    const values: (string | number | boolean)[] =
      field.kind === 'ref' ? refs.map(r => r.text) : asArray(node.props[field.name] as never);

    const control = (i: number, v: string | number | boolean | undefined): HTMLElement => {
      const idx = field.many ? i : undefined;
      const text = v === undefined ? '' : String(v);
      if (field.kind === 'ref') return this.refSelect(text, refs[i]?.resolved ?? true, field, x => set(x || null, idx));
      if (field.kind === 'enum') {
        return h('select', { onchange: (e: Event) => set((e.target as HTMLSelectElement).value || null, idx) },
          !field.required && h('option', { value: '' }, '(none)'),
          ...(field.options ?? []).map(o => h('option', { value: o, selected: o === text }, o)));
      }
      return h('input', {
        type: field.kind === 'number' ? 'number' : 'text',
        step: field.kind === 'number' ? 'any' : undefined,
        value: text,
        placeholder: field.required ? 'required' : '',
        // `change` fires on blur or Enter, so every keystroke does not rebuild the workspace
        onchange: (e: Event) => {
          const x = (e.target as HTMLInputElement).value;
          set(x === '' ? null : field.kind === 'number' ? Number(x) : x, idx);
        }
      });
    };

    const box = h('div', { class: 'bango-values' });
    if (field.many) {
      values.forEach((v, i) => box.appendChild(h('div', { class: 'bango-item' }, control(i, v),
        h('button', { class: 'bango-x', title: 'Remove', onclick: () => void this.edit({ kind: 'remove', path, feature: field.name, index: i }) }, '×'))));
      box.appendChild(h('button', { onclick: () => void this.edit({ kind: 'add', path, feature: field.name }) }, '+ add'));
    } else {
      box.appendChild(control(0, values[0]));
    }
    return h('div', { class: 'bango-field' }, label, box);
  }

  private refSelect(value: string, resolved: boolean, field: FieldSchema, onPick: (v: string) => void): HTMLElement {
    const options = [...new Set((this.data!.candidates[field.refType ?? ''] ?? []).map(c => c.name))];
    return h('select', { class: resolved ? '' : 'bango-invalid', onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value) },
      (!field.required || !value) && h('option', { value: '', selected: !value }, field.required ? 'choose…' : '(none)'),
      !options.includes(value) && value && h('option', { value, selected: true }, `${value} (unresolved)`),
      ...options.map(o => h('option', { value: o, selected: o === value }, o)));
  }
}
