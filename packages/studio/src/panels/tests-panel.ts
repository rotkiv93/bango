import { messagesOf, type CaseResult, type MetamodelCase } from '@bango/core';
import { clear, empty, h } from '../dom.js';
import type { Panel, PanelHost } from '../types.js';

const toLines = (text: string): string[] => text.split('\n').map(l => l.trim()).filter(Boolean);
const fromLines = (lines: string[] | undefined): string => (lines ?? []).join('\n');

interface Row {
  el: HTMLElement;
  status: HTMLElement;
  failures: HTMLElement;
  expectBtn: HTMLButtonElement;
}

/**
 * Sample instances of the metamodel and what they must report: tests for its grammar and constraints. They are kept in the cases file
 * (`<name>.cases.json`, a JSON array) and rerun as the metamodel changes.
 */
export class TestsPanel implements Panel {
  private root!: HTMLElement;
  private cases: MetamodelCase[] = [];
  private invalid: string | undefined;
  private results: CaseResult[] = [];
  private failure: string | undefined;
  private rows: Row[] = [];
  private summary!: HTMLElement;
  private list!: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private offRevision?: () => void;
  private seq = 0;
  private lastText: string | undefined;

  constructor(private studio: PanelHost) {}

  mount(el: HTMLElement): void {
    this.root = h('div', { class: 'bs-host bs-scroll' });
    el.appendChild(this.root);
    this.offRevision = this.studio.onRevision(() => { this.load(); this.schedule(); });
    this.load();
    this.render();
    this.schedule();
  }

  activate(): void {
    this.load();
  }

  dispose(): void {
    this.seq++;
    clearTimeout(this.timer);
    this.offRevision?.();
  }

  /** Read the cases file again when it was changed from outside. */
  private load(): void {
    const text = this.studio.files.cases;
    if (text === this.lastText) return;
    this.lastText = text;
    this.invalid = undefined;
    this.cases = [];
    if (text !== undefined && text.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('it must be a JSON array of cases');
        this.cases = parsed as MetamodelCase[];
      } catch (e) {
        this.invalid = (e as Error).message;
      }
    }
    this.render();
  }

  private save(): void {
    const text = this.cases.length ? `${JSON.stringify(this.cases, null, 2)}\n` : '';
    this.lastText = text;
    this.studio.edit('cases', text);
    this.schedule();
  }

  private update(index: number, patch: Partial<MetamodelCase>): void {
    this.cases = this.cases.map((c, i) => (i === index ? { ...c, ...patch } : c));
    this.save();
  }

  private updateExpect(index: number, patch: Partial<MetamodelCase['expect']>): void {
    this.update(index, { expect: { ...this.cases[index]!.expect, ...patch } });
  }

  private async add(): Promise<void> {
    let text = '';
    try { text = (await this.studio.bango.getInstance(this.studio.metamodel)).text; } catch { /* an empty sample */ }
    this.cases = [...this.cases, { name: `case ${this.cases.length + 1}`, text, expect: {} }];
    this.save();
    this.render();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const seq = ++this.seq;
    this.timer = setTimeout(async () => {
      if (this.invalid || !this.cases.length) { this.results = []; this.failure = undefined; this.paint(); return; }
      try {
        const found = await this.studio.bango.runCases(this.studio.metamodel, this.cases);
        if (seq !== this.seq) return;
        this.results = found;
        this.failure = undefined;
      } catch (e) {
        if (seq !== this.seq) return;
        this.failure = (e as Error).message;
      }
      this.paint();
    }, 400);
  }

  private requires(): string[] {
    return this.studio.catalog.find(g => g.name === this.studio.metamodel)?.requires ?? [];
  }

  private render(): void {
    clear(this.root);
    this.rows = [];
    const readOnly = !!this.studio.input.readOnly;
    this.summary = h('strong');
    const addButton = h('button', { class: 'bs-btn primary', type: 'button', disabled: readOnly || !!this.invalid, onclick: () => void this.add() }, '+ Add case from the preview');
    this.root.appendChild(h('div', { class: 'bs-toolbar' }, h('div', {}, this.summary, h('span', { class: 'bs-muted' }, ' A case is a sample instance and the errors it must report. They rerun when the metamodel changes.')), h('span', { class: 'bs-spacer' }), addButton));
    if (this.invalid) {
      this.root.appendChild(h('div', { class: 'bs-banner', role: 'alert' }, `The cases file is not valid: ${this.invalid}`));
      return;
    }
    this.root.appendChild(h('div', { class: 'bs-banner', role: 'alert', hidden: true, 'data-failure': '' }));
    this.list = h('div');
    this.root.appendChild(this.list);
    if (!this.cases.length) {
      this.list.appendChild(empty('Test this metamodel', 'Add a sample instance, say what it must report, and keep editing the grammar and constraints with that safety net.'));
    }
    this.cases.forEach((c, i) => this.list.appendChild(this.renderCase(c, i, readOnly)));
    this.paint();
  }

  private renderCase(c: MetamodelCase, i: number, readOnly: boolean): HTMLElement {
    const status = h('span', { class: 'bs-status', title: 'Not run yet' }, '…');
    const failures = h('ul', { class: 'bs-failures' });
    const expectBtn = h('button', {
      class: 'bs-btn', type: 'button', hidden: true, title: 'Set the expectations to what this instance reports now',
      onclick: () => {
        const result = this.results[i];
        if (!result) return;
        this.updateExpect(i, { errors: messagesOf(result.problems, 'error'), ...(this.cases[i]!.expect.warnings ? { warnings: messagesOf(result.problems, 'warning') } : {}) });
        this.render();
      }
    }, 'Expect what it reports');
    const textarea = (value: string, rows: number, label: string, onInput: (v: string) => void): HTMLTextAreaElement => {
      const t = h('textarea', { rows, spellcheck: false, readOnly, 'aria-label': label });
      t.value = value;
      t.addEventListener('input', () => onInput(t.value));
      return t;
    };
    const warnings = h('div');
    const paintWarnings = (): void => {
      clear(warnings);
      if (this.cases[i]!.expect.warnings !== undefined) {
        warnings.appendChild(textarea(fromLines(this.cases[i]!.expect.warnings), 2, 'Warnings it must report', v => this.updateExpect(i, { warnings: toLines(v) })));
      }
    };
    const check = h('input', { type: 'checkbox', checked: c.expect.warnings !== undefined, disabled: readOnly });
    check.addEventListener('change', () => { this.updateExpect(i, { warnings: check.checked ? [] : undefined }); paintWarnings(); });
    paintWarnings();

    const name = h('input', { type: 'text', 'aria-label': 'Case name', value: c.name, readOnly });
    name.addEventListener('input', () => this.update(i, { name: name.value }));
    const remove = h('button', { class: 'bs-btn', type: 'button', title: 'Remove this case', 'aria-label': 'Remove this case', disabled: readOnly, onclick: () => { this.cases = this.cases.filter((_, j) => j !== i); this.results = []; this.save(); this.render(); } }, '×');

    const requires = this.requires();
    const withDetails = requires.length
      ? h('details', { open: !!c.with && Object.keys(c.with).length > 0 },
        h('summary', {}, `Instances of the metamodels it needs (${requires.join(', ')})`),
        ...requires.map(r => h('label', { class: 'bs-field' }, h('span', {}, r), textarea(c.with?.[r] ?? '', 4, `Instance of ${r}`, v => this.update(i, { with: { ...this.cases[i]!.with, [r]: v } })))))
      : null;

    const el = h('div', { class: 'bs-case' },
      h('div', { class: 'bs-case-head' }, status, name, remove),
      failures,
      h('div', { class: 'bs-case-body' },
        h('label', { class: 'bs-field' }, h('span', {}, 'Instance'), textarea(c.text, Math.max(4, c.text.split('\n').length), 'Instance', v => this.update(i, { text: v }))),
        h('div', {},
          h('label', { class: 'bs-field' }, h('span', {}, 'Errors it must report (one per line, a piece of the message is enough)'), textarea(fromLines(c.expect.errors), 3, 'Errors it must report', v => this.updateExpect(i, { errors: toLines(v) }))),
          h('label', {}, check, ' Check warnings too'),
          warnings,
          expectBtn)),
      withDetails);
    this.rows[i] = { el, status, failures, expectBtn };
    return el;
  }

  /** Show what the last run found without rebuilding the inputs (the user may be typing in one). */
  private paint(): void {
    if (!this.summary) return;
    const passed = this.results.filter(r => r.ok).length;
    this.summary.textContent = this.cases.length ? `${passed} of ${this.cases.length} passing` : 'No test cases yet';
    const banner = this.root.querySelector<HTMLElement>('[data-failure]');
    if (banner) { banner.hidden = !this.failure; banner.textContent = this.failure ?? ''; }
    this.rows.forEach((row, i) => {
      const result = this.results[i];
      row.el.classList.toggle('pass', !!result?.ok);
      row.el.classList.toggle('fail', !!result && !result.ok);
      row.status.className = `bs-status ${result ? (result.ok ? 'ok' : 'err') : ''}`;
      row.status.textContent = result ? (result.ok ? '✓' : '✖') : '…';
      row.status.title = result ? (result.ok ? 'Passing' : 'Failing') : 'Not run yet';
      clear(row.failures);
      if (result && !result.ok) for (const f of result.failures) row.failures.appendChild(h('li', {}, f));
      row.expectBtn.hidden = !result || result.ok || !!this.studio.input.readOnly;
    });
  }
}
