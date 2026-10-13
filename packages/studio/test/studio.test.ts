// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Problem } from '@bango/core';
import { Bango } from '@bango/engine';
import { VISUALIZATION_TYPINGS, VisualizationStore, visualizationViews } from '@bango/renderer';
import { MetamodelStudio, type MetamodelFiles, type MonacoApi, type RendererLibrary, type StudioInput } from '../src/index.js';
import { loadSeed } from '../../../test-support/seed.js';

// Monaco and the renderer library are the page's: here they are stand-ins that record what the studio asks of them
class FakeEditor {
  static all: FakeEditor[] = [];
  value: string;
  language: string;
  problems: Problem[] = [];
  disposed = false;
  editor = { layout: () => undefined };
  constructor(_monaco: unknown, _el: HTMLElement, public options: { uri: string; language: string; value?: string; onChange?(v: string): void; editorOptions?: { readOnly?: boolean } }) {
    this.value = options.value ?? '';
    this.language = options.language;
    FakeEditor.all.push(this);
  }
  setValue(text: string) { this.value = text; }
  setLanguage(id: string) { this.language = id; }
  setProblems(problems: Problem[]) { this.problems = problems; }
  reveal = vi.fn();
  dispose() { this.disposed = true; }
  /** the user types */
  type(text: string) { this.value = text; this.options.onChange?.(text); }
}

const views: string[] = [];
class FakeModelRenderer {
  constructor(public engine: unknown, public options: unknown) {}
  async mount(_el: HTMLElement, metamodel: string, view: string) { views.push(`${metamodel}:${view}`); }
  async setView(view: string) { views.push(`view:${view}`); }
  async refresh() {}
  dispose() {}
}
class FakeAstRenderer {
  updates: unknown[] = [];
  constructor(public ctx: unknown, public scope: string) {}
  mount() {}
  async update(state: unknown) { this.updates.push(state); }
  dispose() {}
}

const renderer: RendererLibrary = {
  ModelRenderer: FakeModelRenderer as never,
  AstRenderer: FakeAstRenderer as never,
  CodeEditor: FakeEditor as never,
  VisualizationStore,
  visualizationViews,
  VISUALIZATION_TYPINGS,
  injectStyles: () => undefined,
  registerCodeLanguages: () => undefined,
  javascriptMonarch: {} as never
};
const monaco = {} as MonacoApi;

const seed = loadSeed();
const NAME = 'datamodel';
const filesOf = (name: string): MetamodelFiles => ({
  grammar: seed.grammars[name]!,
  constraints: seed.constraints[name],
  scope: seed.scopes[name],
  spec: seed.specs[name],
  import: seed.imports[name],
  visualizations: seed.visualizations[name],
  cases: seed.cases[name]?.length ? JSON.stringify(seed.cases[name]) : undefined
});

const studios: MetamodelStudio[] = [];
async function open(overrides: Partial<StudioInput> = {}) {
  const bango = new Bango();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const studio = new MetamodelStudio({
    bango,
    monaco,
    renderer,
    metamodel: NAME,
    files: filesOf(NAME),
    dependencies: { common: filesOf('common') },
    ...overrides
  });
  studios.push(studio);
  await studio.mount(el);
  return { studio, bango, el };
}

const editorFor = (key: string) => FakeEditor.all.find(e => e.options.uri.endsWith(`/${NAME}/${key}`) && !e.disposed)!;
const tab = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.bs-tab')].find(b => b.textContent!.startsWith(label))!;

afterEach(() => {
  studios.splice(0).forEach(s => s.dispose());
  FakeEditor.all = [];
  views.length = 0;
  document.body.innerHTML = '';
});

describe('MetamodelStudio', () => {
  it('loads the metamodel and what it imports, composes them, and shows the grammar', async () => {
    const { studio, bango, el } = await open();
    expect(editorFor('grammar').value).toBe(seed.grammars[NAME]);
    expect(editorFor('grammar').options.language).toBe('langium');
    expect([...el.querySelectorAll('.bs-tab')].map(t => t.textContent!.replace(/ [•(].*/, ''))).toEqual(
      ['Grammar', 'Constraints', 'Scope', 'JSON mapping', 'JSON import', 'Visualizations', 'Tests', 'Composed', 'AST', 'Preview', 'Imports']
    );
    expect(studio.catalog.find(g => g.name === NAME)).toMatchObject({ extension: 'datamodel', requires: [] });
    expect(await bango.getComposition()).toBeDefined();
    expect(el.querySelector('.bs-status')!.textContent).toBe('✓');
    expect(studio.dirty()).toEqual([]);
  });

  it('a library has only its grammar', async () => {
    const { el } = await open({ metamodel: 'common', files: filesOf('common'), dependencies: {} });
    expect([...el.querySelectorAll('.bs-tab')].map(t => t.textContent)).toEqual(['Grammar']);
  });

  it('tells the page what was edited, and which files differ from the saved ones', async () => {
    const { studio } = await open();
    const changes: string[] = [];
    studio.on('change', ({ key }) => changes.push(key));
    editorFor('grammar').type(`${seed.grammars[NAME]}\n// edited\n`);
    expect(changes).toEqual(['grammar']);
    expect(studio.files.grammar).toContain('// edited');
    expect(studio.dirty()).toEqual(['grammar']);
    studio.markSaved();
    expect(studio.dirty()).toEqual([]);
    editorFor('grammar').type(seed.grammars[NAME]!);
    expect(studio.dirty()).toEqual(['grammar']);
  });

  it('reports the problems of a broken grammar, and clears them when it is fixed', async () => {
    const { studio, el } = await open();
    const seen: Problem[][] = [];
    studio.on('problems', p => seen.push(p));
    editorFor('grammar').type(`${seed.grammars[NAME]}\nBroken: ;;;\n`);
    await vi.waitFor(() => expect(seen.at(-1)!.some(p => p.severity === 'error')).toBe(true));
    expect(el.querySelector('.bs-status')!.className).toContain('err');
    expect(el.querySelectorAll('.bs-problems li').length).toBeGreaterThan(0);
    expect(editorFor('grammar').problems.length).toBeGreaterThan(0);

    seen.length = 0;
    editorFor('grammar').type(seed.grammars[NAME]!);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));
    expect(el.querySelector('.bs-status')!.textContent).toBe('✓');
  });

  it('shows a position of a problem in the grammar editor', async () => {
    const { studio, el } = await open();
    editorFor('grammar').type(`${seed.grammars[NAME]}\nBroken: ;;;\n`);
    await vi.waitFor(() => expect(el.querySelectorAll('.bs-problems li button').length).toBeGreaterThan(0));
    tab(el, 'Constraints').click();
    el.querySelector<HTMLButtonElement>('.bs-problems li button')!.click();
    expect(tab(el, 'Grammar').getAttribute('aria-selected')).toBe('true');
    expect(editorFor('grammar').reveal).toHaveBeenCalled();
    expect(studio.dirty()).toEqual(['grammar']);
  });

  it('gives the engine a changed script, and lets it go when it is emptied', async () => {
    const { bango, studio } = await open();
    const spy = vi.spyOn(bango, 'setConstraints');
    tab(studio['root']!, 'Constraints').click();
    editorFor('constraints').type('return []');
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(NAME, 'return []'));
    editorFor('constraints').type('');
    await vi.waitFor(() => expect(spy).toHaveBeenLastCalledWith(NAME, ''));
    await vi.waitFor(() => expect(studio.catalog.find(g => g.name === NAME)?.problems).toEqual([]));
    expect(await bango.getComposition()).toBeDefined(); // still composed without the script
  });

  it('runs the test cases and shows which pass', async () => {
    const cases = JSON.stringify([
      { name: 'valid', text: 'datamodel shop\n\nentity A {\n  property name: String\n}\n', expect: {} },
      { name: 'unresolved', text: 'datamodel shop\n\nentity A {\n  relation b -> Missing\n}\n', expect: {} }
    ]);
    const { studio, el } = await open({ files: { ...filesOf(NAME), cases } });
    expect(tab(el, 'Tests').textContent).toBe('Tests (2)');
    tab(el, 'Tests').click();
    await vi.waitFor(() => expect(el.querySelector('.bs-panel.on strong')!.textContent).toBe('1 of 2 passing'), { timeout: 5000 });
    const cards = el.querySelectorAll('.bs-case');
    expect(cards[0]!.classList.contains('pass')).toBe(true);
    expect(cards[1]!.classList.contains('fail')).toBe(true);
    expect(cards[1]!.querySelector('.bs-failures')!.textContent).toMatch(/Missing/);

    // "Expect what it reports" makes the failing case pass, and the cases file changes
    const changes: string[] = [];
    studio.on('change', ({ key }) => changes.push(key));
    const expectBtn = [...cards[1]!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Expect what it reports')!;
    expectBtn.click();
    expect(changes).toContain('cases');
    expect(JSON.parse(studio.files.cases!)[1].expect.errors[0]).toMatch(/Missing/);
    await vi.waitFor(() => expect(el.querySelector('.bs-panel.on strong')!.textContent).toBe('2 of 2 passing'), { timeout: 5000 });
  });

  it('adds a case from the preview and removes one', async () => {
    const { studio, el } = await open({ files: { ...filesOf(NAME), cases: undefined } });
    tab(el, 'Preview').click();
    await vi.waitFor(() => expect(views).toContain(`${NAME}:text`));
    tab(el, 'Tests').click();
    const add = [...el.querySelectorAll<HTMLButtonElement>('.bs-panel.on button')].find(b => b.textContent!.startsWith('+ Add case'))!;
    add.click();
    await vi.waitFor(() => expect(JSON.parse(studio.files.cases!)).toHaveLength(1));
    expect(JSON.parse(studio.files.cases!)[0].text).toMatch(/^datamodel/);
    el.querySelector<HTMLButtonElement>('.bs-case [aria-label="Remove this case"]')!.click();
    expect(studio.files.cases).toBe('');
  });

  it('shows the composed grammar and the AST of the grammar', async () => {
    const { el, bango } = await open();
    tab(el, 'Composed').click();
    await vi.waitFor(() => expect(FakeEditor.all.some(e => e.options.uri.endsWith('/composed') && e.value.includes('grammar'))).toBe(true));
    const ast = vi.spyOn(bango, 'getGrammarAst');
    tab(el, 'AST').click();
    await vi.waitFor(() => expect(ast).toHaveBeenCalledWith(NAME));
  });

  it('previews an instance, switching views', async () => {
    const { el } = await open({ instances: { [NAME]: seed.projects['shop']!.instances[NAME] } as Record<string, string> });
    tab(el, 'Preview').click();
    await vi.waitFor(() => expect(views).toContain(`${NAME}:text`));
    [...el.querySelectorAll<HTMLButtonElement>('.bs-seg button')].find(b => b.textContent === 'Diagram')!.click();
    await vi.waitFor(() => expect(views).toContain('view:diagram'));
  });

  it('starts the preview from the first test case when the page gave no sample, and from the sample the page gave when it did', async () => {
    const cases = JSON.stringify([{ name: 'a', text: 'datamodel from_case\n\nentity Case {\n  property name: String\n}\n', expect: {} }]);
    const fromCase = await open({ files: { ...filesOf(NAME), cases } });
    expect((await fromCase.bango.getInstance(NAME)).text).toContain('from_case');
    fromCase.studio.dispose();

    const given = await open({ files: { ...filesOf(NAME), cases }, instances: { [NAME]: 'datamodel from_page\n' } });
    expect((await given.bango.getInstance(NAME)).text).toContain('from_page');

    const none = await open({ files: { ...filesOf(NAME), cases: undefined } });
    expect((await none.bango.getInstance(NAME)).text).not.toContain('from_');
  });

  it('shows the imported metamodels read-only', async () => {
    const { el } = await open();
    tab(el, 'Imports').click();
    const dependency = FakeEditor.all.find(e => e.options.uri.includes('/dependency/common'))!;
    expect(dependency.value).toBe(seed.grammars['common']);
    expect(dependency.options.editorOptions?.readOnly).toBe(true);
  });

  describe('visualizations', () => {
    const FILE = "return [{ id: 'mine', label: 'Mine', create: () => ({ mount() {}, update() {}, dispose() {} }) }];";

    it('are a file of their own that the engine never sees, and the page is told when it changes', async () => {
      const { studio, bango, el } = await open();
      const spies = [vi.spyOn(bango, 'setConstraints'), vi.spyOn(bango, 'setSpec'), vi.spyOn(bango, 'setImport'), vi.spyOn(bango, 'setScope')];
      const changes: string[] = [];
      studio.on('change', ({ key }) => changes.push(key));
      expect(studio.files.visualizations).toBe(seed.visualizations[NAME]);
      tab(el, 'Visualizations').click();
      expect(editorFor('visualizations').options.language).toBe('bango-js');
      editorFor('visualizations').type(FILE);
      expect(changes).toEqual(['visualizations']);
      expect(studio.dirty()).toEqual(['visualizations']);
      await new Promise(r => setTimeout(r, 300));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(studio.visualizations.get(NAME)).toBe(FILE);
    });

    it('become views of the preview as they are typed, and go when they are emptied', async () => {
      const { el } = await open();
      tab(el, 'Preview').click();
      const labels = () => [...el.querySelectorAll<HTMLButtonElement>('.bs-seg button')].map(b => b.textContent);
      await vi.waitFor(() => expect(labels()).toContain('Class diagram'));
      tab(el, 'Visualizations').click();
      editorFor('visualizations').type(FILE);
      await vi.waitFor(() => expect(labels()).toContain('Mine'));
      expect(labels()).not.toContain('Class diagram');
      editorFor('visualizations').type('return nonsense;');
      await vi.waitFor(() => expect(labels()).toContain('Visualizations'));
      editorFor('visualizations').type('');
      await vi.waitFor(() => expect(labels()).toEqual(['Text', 'Form', 'Diagram', 'JSON']));
    });

    it('are shown to the language service with what a visualization is given, not the AST types', async () => {
      const addExtraLib = vi.fn(() => ({ dispose() {} }));
      const service = {
        javascriptDefaults: { setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn(), addExtraLib },
        ScriptTarget: { ES2022: 9 }
      };
      const fakeMonaco = { languages: { register: vi.fn(), setMonarchTokensProvider: vi.fn() } } as unknown as MonacoApi;
      const { el } = await open({ monaco: fakeMonaco, typescript: () => Promise.resolve(service) });
      tab(el, 'Visualizations').click();
      await vi.waitFor(() => expect(addExtraLib.mock.calls.some(call => String((call as unknown[])[0]).includes('interface VisualizationKit'))).toBe(true));
    });

    it('are replaced with the other files on reset', async () => {
      const { studio } = await open();
      await studio.reset({ ...filesOf(NAME), visualizations: undefined });
      expect(studio.visualizations.get(NAME)).toBeUndefined();
      expect(studio.dirty()).toEqual([]);
    });
  });

  it('script editors turn on the language service when the page gave one, and give it the typings', async () => {
    const addExtraLib = vi.fn(() => ({ dispose() {} }));
    const service = {
      javascriptDefaults: { setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn(), addExtraLib },
      ScriptTarget: { ES2022: 9 }
    };
    const registered: string[] = [];
    const fakeMonaco = { languages: { register: ({ id }: { id: string }) => registered.push(id), setMonarchTokensProvider: vi.fn() } } as unknown as MonacoApi;
    const { el } = await open({ monaco: fakeMonaco, typescript: () => Promise.resolve(service) });
    tab(el, 'Constraints').click();
    await vi.waitFor(() => expect(editorFor('constraints').language).toBe('javascript'));
    await vi.waitFor(() => expect(addExtraLib).toHaveBeenCalled());
    expect(String((addExtraLib.mock.calls as unknown[][])[0]![0])).toContain('Entity');
    expect(registered).toContain('javascript');
  });

  it('without a language service the script editors stay plain', async () => {
    const { el } = await open();
    tab(el, 'Constraints').click();
    expect(editorFor('constraints').language).toBe('bango-js');
  });

  it('is read-only when it is told to be, and can be reset with other files', async () => {
    const { studio } = await open({ readOnly: true });
    editorFor('grammar').type('grammar X');
    expect(studio.dirty()).toEqual([]);

    const edited = { ...filesOf(NAME), grammar: `${seed.grammars[NAME]}\n// other version\n` };
    await studio.reset(edited);
    expect(studio.files.grammar).toContain('other version');
    expect(studio.dirty()).toEqual([]);
    expect(editorFor('grammar').value).toContain('other version');
  });

  it('refuses to be mounted twice, and removes itself on dispose', async () => {
    const { studio, el } = await open();
    await expect(studio.mount(el)).rejects.toThrow(/already mounted/);
    studio.dispose();
    expect(el.querySelector('.bs')).toBeNull();
    expect(FakeEditor.all.every(e => e.disposed)).toBe(true);
  });
});
