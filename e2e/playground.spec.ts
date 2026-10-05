import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const GRESINT_JSON = readFileSync(new URL('../examples/seed/expected/sensors_gresint.json', import.meta.url), 'utf8');
const PROJECTS = ['catalog', 'city', 'everything', 'gresint', 'office', 'portal', 'shop'];

/** A fresh browser context each test, so each starts from the examples. */
async function start(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().split('\n')[0]); });
  await page.goto('/');
  await page.locator('.topbar').waitFor();
  // the engine (in a worker) is ready when the projects page lists the examples
  await expect(page.locator('.card h3').first()).toBeVisible();
  return errors;
}

async function openProject(page: Page, name: string) {
  await page.locator('.topbar nav button', { hasText: 'Projects' }).click();
  await page.locator('.card', { has: page.locator(`h3:text-is("${name}")`) }).click();
  await expect(page.locator('.project-head h1')).toHaveText(name);
}

const tab = (page: Page, name: string) => page.locator('.tabbar button', { hasText: name });
// Monaco writes spaces as non-breaking spaces
const editorText = async (page: Page) => (await page.locator('.view-area .monaco-editor .view-lines').first().innerText()).replaceAll(' ', ' ');
const view = (page: Page, name: string) => page.locator('.segmented button', { hasText: name }).click();

test.describe('the examples', () => {
  for (const name of PROJECTS) {
    test(`${name} opens, every instance is clean, and it builds`, async ({ page }) => {
      const errors = await start(page);
      await openProject(page, name);
      await expect(page.locator('.overview .card-head .status.err')).toHaveCount(0);
      await page.getByRole('button', { name: 'Build model' }).click();
      await expect(page.locator('.banner.ok')).toContainText('Build succeeded');
      expect(errors).toEqual([]);
    });
  }

  test('all of them are offered, and the fixtures that exist to be rejected are not', async ({ page }) => {
    await start(page);
    await expect(page.locator('.card h3')).toHaveText(PROJECTS);
  });
});

test.describe('metamodels and their scripts', () => {
  test('the TypeScript service loads only when a script is opened, then completes and checks', async ({ page }) => {
    const workerRequests: string[] = [];
    page.on('request', r => { if (/ts\.worker/.test(r.url())) workerRequests.push(r.url()); });
    const errors = await start(page);
    await page.locator('.topbar nav button', { hasText: 'Metamodels' }).click();
    await page.locator('.mm-item', { has: page.locator('strong:text-is("datamodel")') }).click();
    expect(workerRequests).toEqual([]);

    await view(page, 'Constraints');
    await expect(page.locator('.mm-editor .monaco-editor')).toBeVisible();
    await expect.poll(() => workerRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    // the shipped script type-checks against the types of its grammar
    await expect(page.locator('.mm-editor .squiggly-error')).toHaveCount(0);

    await page.locator('.mm-editor .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('/** @type {Constraints} */\nconst c = { Entity(entity, accept) { entity.');
    await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toContainText(['fields', 'name']);
    await page.keyboard.press('Escape');
    await page.keyboard.type('feilds.length; } };\nreturn c;');
    await expect(page.locator('.mm-editor .squiggly-error')).not.toHaveCount(0);
    expect(errors.filter(e => !/exploded|feilds|undefined/.test(e))).toEqual([]);
  });

  test('every metamodel that ships has test cases, and they pass', async ({ page }) => {
    await start(page);
    await page.locator('.topbar nav button', { hasText: 'Metamodels' }).click();
    for (const name of ['datamodel', 'forms', 'gismodel', 'lists', 'menus', 'security']) {
      await page.locator('.mm-item', { has: page.locator(`strong:text-is("${name}")`) }).click();
      await view(page, 'Tests');
      const summary = page.locator('.tests-head strong');
      await expect(summary).toHaveText(/^(\d+) of \1 passing$/, { timeout: 30_000 });
      await expect(page.locator('.case.fail')).toHaveCount(0);
    }
  });

  test('a new metamodel starts from a minimal grammar and appears in the catalog', async ({ page }) => {
    await start(page);
    await page.locator('.topbar nav button', { hasText: 'Metamodels' }).click();
    await page.getByRole('button', { name: '+ New metamodel' }).click();
    await page.locator('.dialog input').fill('Bad Name');
    await expect(page.locator('.dialog .err')).toBeVisible();
    await page.locator('.dialog input').fill('billing');
    await page.locator('.dialog button.primary').click();
    await expect(page.locator('.mm-item', { has: page.locator('strong:text-is("billing")') })).toBeVisible();
    await expect(page.locator('.mm-item.on .status.ok')).toBeVisible();
  });
});

test.describe('projects', () => {
  test('a project is created only when the metamodels fit, and the dialog says what to add', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: '+ New project' }).click();
    await page.locator('.dialog input[placeholder]').fill('maps');
    await page.locator('.mm-card', { has: page.locator('strong:text-is("gismodel")') }).click();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('.dialog .banner.err')).toContainText("'gismodel' needs 'datamodel'");
    await page.getByRole('button', { name: 'Add what is missing' }).click();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('.project-head h1')).toHaveText('maps');
  });

  test('JSON of a whole project fills the instances, and the project builds to the same document', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: '+ New project' }).click();
    await page.locator('.dialog input[placeholder]').fill('imported');
    for (const m of ['basic', 'datamodel', 'gismodel', 'sensors']) await page.locator('.mm-card', { has: page.locator(`strong:text-is("${m}")`) }).click();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('.project-head h1')).toHaveText('imported');

    await page.getByRole('button', { name: 'Import JSON' }).click();
    await page.locator('.import-json').fill('{ nope');
    await expect(page.locator('.dialog .banner.err')).toContainText('not valid JSON');
    await page.locator('.import-json').fill(GRESINT_JSON);
    await expect(page.locator('.import-row')).toHaveCount(4);
    await page.locator('.dialog button.primary').click();
    await expect(page.locator('.overview .card-head .status.ok')).toHaveCount(4);
    await page.getByRole('button', { name: 'Build model' }).click();
    await expect(page.locator('.banner.ok')).toContainText('Build succeeded: 4 instance(s)');
  });
});

test.describe('editing across metamodels', () => {
  test('rename changes every use in every instance, and the instance can be undone', async ({ page }) => {
    const errors = await start(page);
    await openProject(page, 'city');
    await tab(page, 'datamodel').click();
    await expect(page.locator('.view-area .monaco-editor .view-lines')).toBeVisible();
    await page.locator('.view-lines .view-line:has-text("entity Road") span >> text=Road').first().dblclick();
    await page.keyboard.press('F2');
    await page.waitForTimeout(800);
    await page.keyboard.type('Street');
    await page.keyboard.press('Enter');
    await expect.poll(() => editorText(page)).toContain('entity Street');
    expect(await editorText(page)).toContain('relation road -> Street');

    await tab(page, 'gismodel').click();
    await expect.poll(() => editorText(page)).toContain('entity Street');
    await expect(page.locator('.workspace .toolbar .status.ok')).toBeVisible();

    await tab(page, 'datamodel').click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => editorText(page)).toContain('entity Road');
    expect(errors).toEqual([]);
  });

  test('a reference to something that does not exist offers to create it where it belongs', async ({ page }) => {
    await start(page);
    await openProject(page, 'city');
    await tab(page, 'gismodel').click();
    await page.locator('.view-area .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\ngeojsonlayer extra entity Nowhere defaultStyle thin availableStyles thin\n');
    await expect(page.locator('.problems')).toContainText('Nowhere');
    await page.locator('.view-lines .view-line:has-text("entity Nowhere") span >> text=Nowhere').first().dblclick();
    await page.keyboard.press('Control+.');
    await expect(page.locator('.action-widget:not(.action-list-submenu-panel)')).toContainText("Create Entity 'Nowhere' in datamodel");
    await page.keyboard.press('Enter');
    await tab(page, 'datamodel').click();
    await expect.poll(() => editorText(page)).toContain('entity Nowhere');
  });

  test('find references and the outline see across instances', async ({ page }) => {
    await start(page);
    await openProject(page, 'city');
    await tab(page, 'datamodel').click();
    await page.locator('.view-lines .view-line:has-text("entity Road") span >> text=Road').first().dblclick();
    await page.keyboard.press('Shift+F12');
    await expect(page.locator('.reference-zone-widget')).toContainText('References (3)');
    await page.keyboard.press('Escape');
    await page.locator('.view-area .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+Shift+O');
    await expect(page.locator('.quick-input-list')).toContainText('Parcel');
  });

  test('the form refuses to remove what the grammar requires, and says so', async ({ page }) => {
    await start(page);
    await openProject(page, 'shop');
    await tab(page, 'datamodel').click();
    await view(page, 'Form');
    await expect(page.locator('.bango-form .bango-node').first()).toBeVisible();
    for (let i = 0; i < 6; i++) {
      const buttons = page.locator('.bango-form .bango-node .bango-node .bango-node .bango-x');
      if (!(await buttons.count())) break;
      await buttons.first().click();
      if (await page.locator('.bango-form-error').count()) break;
      await page.waitForTimeout(300);
    }
    await expect(page.locator('.bango-form-error')).toContainText(/needs at least one/);
  });
});

test('the examples can be restored, and anything added since is gone', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '+ New project' }).click();
  await page.locator('.dialog input[placeholder]').fill('extra');
  await page.locator('.mm-card', { has: page.locator('strong:text-is("datamodel")') }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('.project-head h1')).toHaveText('extra');
  await page.locator('.topbar nav button', { hasText: 'Projects' }).click();
  await expect(page.locator('.card h3')).toHaveCount(PROJECTS.length + 1);

  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Reset examples' }).click();
  await expect(page.locator('.card h3')).toHaveText(PROJECTS);
});
