import { URI, type LangiumServices } from 'langium';
import { createServicesForGrammar } from 'langium/grammar';
import { describe, expect, it } from 'vitest';
import type { Composition } from '@bango/composer';
import { composerWith, openProject } from '../../../test-support/harness.js';
import { loadSeed } from '../../../test-support/seed.js';

/**
 * Bango claims to be plain Langium underneath: a metamodel is a Langium grammar, its imports are inlined the way `langium generate`
 * does, and its constraints are Langium validation checks registered with `ValidationRegistry.register`. These tests hold it to that: they
 * build ordinary Langium services (no Bango engine) from the composed grammar of each metamodel, register the constraint modules
 * through Langium's own registry, and compare what Langium says about the shipped instances with what Bango says.
 */

type Diagnostic = { severity: string; message: string; start: string; end: string };
const SEVERITIES = ['', 'error', 'warning', 'info', 'hint'];

/** A reference that points into another instance cannot resolve in a single-document Langium service, so it is left out of the comparison. */
const crossDocument = (d: Diagnostic) => /Could not resolve reference/.test(d.message);

async function plainLangium(composition: Composition, metamodel: string): Promise<{ services: LangiumServices; extension: string }> {
  const m = composition.get(metamodel)!;
  const services = await createServicesForGrammar({
    grammar: composition.bundleText(metamodel),
    languageMetaData: { languageId: m.extension, fileExtensions: [`.${m.extension}`], caseInsensitive: false, mode: 'development' }
  });
  // Langium's own registration of validators
  for (const { checks, thisObj, category } of m.constraints) services.validation.ValidationRegistry.register(checks as never, thisObj, category);
  return { services, extension: m.extension };
}

async function diagnose({ services, extension }: { services: LangiumServices; extension: string }, text: string, n: number): Promise<Diagnostic[]> {
  const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = services.shared.workspace;
  const doc = LangiumDocumentFactory.fromString(text, URI.parse(`file:///conformance/${n}.${extension}`));
  LangiumDocuments.addDocument(doc);
  await DocumentBuilder.build([doc], { validation: true });
  return (doc.diagnostics ?? []).map(d => ({
    severity: SEVERITIES[d.severity ?? 1],
    message: typeof d.message === 'string' ? d.message : (d.message as { value: string }).value,
    start: `${d.range.start.line}:${d.range.start.character}`,
    end: `${d.range.end.line}:${d.range.end.character}`
  }));
}

const asDiagnostics = (problems: { severity: string; message: string; startLine: number; startColumn: number; endLine: number; endColumn: number }[]): Diagnostic[] =>
  problems.map(p => ({ severity: p.severity, message: p.message, start: `${p.startLine}:${p.startColumn}`, end: `${p.endLine}:${p.endColumn}` }));

const sorted = (ds: Diagnostic[]) => [...ds].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('metamodels are plain Langium', () => {
  it('the composed grammar of every metamodel is accepted by Langium on its own, with no errors', async () => {
    const { composer } = composerWith();
    const composition = await composer.compose();
    for (const m of composition.metamodels) {
      const plain = await plainLangium(composition, m.name);
      expect(plain.services.Grammar.rules.length, m.name).toBeGreaterThan(0);
    }
  });

  it('every grammar of the workspace passes Langium validation without errors, libraries included', async () => {
    const { composer } = composerWith();
    for (const g of await composer.metamodels()) {
      expect(g.problems.filter(p => p.severity === 'error').map(p => p.message), g.name).toEqual([]);
    }
  });

  it('Langium and Bango say the same about every shipped instance, and about the same instance cut short', async () => {
    const seed = loadSeed();
    const { composer } = composerWith();
    const composition = await composer.compose();
    const services = new Map<string, Awaited<ReturnType<typeof plainLangium>>>();
    let compared = 0;

    // the fixtures that exist to be rejected (a metamodel without what it needs) are not projects Bango can compose
    for (const project of Object.values(seed.projects).filter(p => p.playground)) {
      const { bango } = await openProject(project.name);
      for (const [metamodel, text] of Object.entries(project.instances)) {
        if (!composition.get(metamodel)) continue;
        if (!services.has(metamodel)) services.set(metamodel, await plainLangium(composition, metamodel));
        const langium = services.get(metamodel)!;

        const variants = [text, text.slice(0, Math.floor(text.length / 2)), text.replace(/\n/g, ' ').slice(0, 80), ''];
        for (const [i, variant] of variants.entries()) {
          const theirs = (await diagnose(langium, variant, compared++)).filter(d => !crossDocument(d));
          const state = await bango.setText(metamodel, variant);
          const ours = asDiagnostics(state.problems).filter(d => !crossDocument(d));
          // what the text itself says (lexer and parser): must be identical, with positions
          const syntax = (ds: Diagnostic[]) => ds.filter(d => /Expecting|mismatched|Unexpected|token|lexing|input/i.test(d.message));
          expect(sorted(syntax(ours)), `${project.name}/${metamodel} variant ${i} (syntax)`).toEqual(sorted(syntax(theirs)));
          // and, for the whole text, the constraints too
          if (i === 0) expect(sorted(ours), `${project.name}/${metamodel} (all)`).toEqual(sorted(theirs));
        }
        await bango.setText(metamodel, text);
      }
    }
    expect(compared).toBeGreaterThan(20);
  }, 120_000);

  it('the checks of the data model give the same diagnostics in plain Langium as in Bango, case by case', async () => {
    const seed = loadSeed();
    const { composer } = composerWith();
    const composition = await composer.compose(['datamodel']);
    const langium = await plainLangium(composition, 'datamodel');
    const { bango } = await openProject('shop');
    let n = 1000;
    for (const c of seed.cases.datamodel) {
      // the data model refers only to itself, so nothing is left out here
      const theirs = await diagnose(langium, c.text, n++);
      const ours = asDiagnostics((await bango.setText('datamodel', c.text)).problems);
      expect(sorted(ours), c.name).toEqual(sorted(theirs));
      // the case expects something: the plain Langium run found it too
      const expected = [...(c.expect.errors ?? []), ...(c.expect.warnings ?? [])];
      for (const piece of expected) expect(theirs.some(d => d.message.includes(piece)), `${c.name}: ${piece}`).toBe(true);
    }
  });
});
