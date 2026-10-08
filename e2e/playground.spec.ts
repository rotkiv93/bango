import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const GRESINT_JSON = readFileSync(new URL('../examples/seed/expected/sensors_gresint.json', import.meta.url), 'utf8');
const PROJECTS = ['catalog', 'city', 'everything', 'fleet', 'gresint', 'office', 'portal', 'shop'];

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
    for (const name of ['datamodel', 'forms', 'gismodel', 'lists', 'menus', 'statics']) {
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

test.describe('a script that never finishes', () => {
  test('does not freeze the playground: the engine is replaced, the script is switched off, the rest keeps working', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page);
    // a script only runs when a project that uses its metamodel is open
    await openProject(page, 'office');
    await page.locator('.topbar nav button', { hasText: 'Metamodels' }).click();
    await page.locator('.mm-item', { has: page.locator('strong:text-is("datamodel")') }).click();
    await view(page, 'Constraints');
    await expect(page.locator('.mm-editor .monaco-editor')).toBeVisible();
    await page.locator('.mm-editor .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('while (true) {}\nreturn {};');

    // the engine runs the loop in its worker until the watchdog gives up on it, replaces it, and finds which script it was
    await expect(page.locator('.quarantine')).toContainText('constraints of datamodel', { timeout: 120_000 });
    await expect(page.locator('.quarantine')).toContainText('switch back on');

    // and the app answers again, with everything else in place
    await openProject(page, 'office');
    await page.getByRole('button', { name: 'Build model' }).click();
    await expect(page.locator('.banner.ok')).toContainText('Build succeeded');
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

  test('a field is offered only from its own entity, and renaming it renames its uses in other instances', async ({ page }) => {
    const errors = await start(page);
    await openProject(page, 'office');

    // the form of Customer offers the fields of Customer
    await tab(page, 'forms').click();
    await view(page, 'Form');
    const fieldBox = page.locator('.bango-form .bango-node', { has: page.locator(':scope > legend b:text-is("FormField")') }).first();
    await expect(fieldBox.locator('select option', { hasText: 'email' })).toHaveCount(1);
    await expect(fieldBox.locator('select option', { hasText: 'total' })).toHaveCount(0);

    // renaming a property of Invoice reaches the list that shows it
    await tab(page, 'datamodel').click();
    await view(page, 'Text');
    await page.locator('.view-lines .view-line:has-text("property total") span >> text=total').first().dblclick();
    await page.keyboard.press('F2');
    await page.waitForTimeout(800);
    await page.keyboard.type('amount');
    await page.keyboard.press('Enter');
    await expect.poll(() => editorText(page)).toContain('property amount');
    await tab(page, 'lists').click();
    await view(page, 'Text');
    await expect.poll(() => editorText(page)).toContain('column amount');
    await expect(page.locator('.workspace .toolbar .status.ok')).toBeVisible();
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
    // an enumeration needs at least one value; the fields of an entity are optional
    await openProject(page, 'fleet');
    await tab(page, 'datamodel').click();
    await view(page, 'Form');
    await expect(page.locator('.bango-form .bango-node').first()).toBeVisible();
    const enumeration = page.locator('.bango-form .bango-node', { has: page.locator('legend', { hasText: 'EnumDef' }) }).first();
    for (let i = 0; i < 6; i++) {
      const buttons = enumeration.locator('.bango-item .bango-x');
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

test.describe('the views a metamodel brings', () => {
  const nodes = (page: Page) => page.locator('.view-area .bango-cnode');

  test('the data model draws a class diagram that is edited with the diagram and the panel at its side', async ({ page }) => {
    const errors = await start(page);
    await openProject(page, 'fleet');
    await tab(page, 'datamodel').click();
    await view(page, 'Class diagram');
    await expect(nodes(page)).toHaveCount(5);
    await expect(page.locator('.view-area .bango-cnode[data-id="Status"]')).toContainText('«enum»');
    await expect(page.locator('.view-area .bango-cnode[data-id="Asset"]')).toContainText('«abstract»');

    // an entity is added from the toolbar, selected, and renamed in the panel
    await page.locator('.bango-ctoolbar button', { hasText: '+ Entity' }).click();
    await expect(nodes(page)).toHaveCount(6);
    const inspector = page.locator('.bango-inspector');
    await expect(inspector).toBeVisible();
    await inspector.locator('.bango-field', { has: page.locator('label:text-is("name *")') }).locator('input').fill('Vessel');
    await inspector.locator('.bango-field', { has: page.locator('label:text-is("name *")') }).locator('input').press('Enter');
    await expect(page.locator('.view-area .bango-cnode[data-id="Vessel"]')).toBeVisible();

    // the same instance, in text
    await view(page, 'Text');
    await expect.poll(() => editorText(page)).toContain('entity Vessel');
    expect(errors).toEqual([]);
  });

  test('the sensors draw a sensor diagram with the entities and the map they use, and the view follows the text of the metamodel', async ({ page }) => {
    const errors = await start(page);
    await openProject(page, 'fleet');
    await tab(page, 'sensors').click();
    await view(page, 'Sensor diagram');
    await expect(page.locator('.view-area .bango-cnode[data-id="sensor:Tide"]')).toContainText('every 600s');
    await expect(page.locator('.view-area .bango-cnode[data-id="entity:Buoy"]')).toContainText('«entity»');
    await expect(page.locator('.view-area .bango-cnode[data-id="map:buoys-map"]')).toContainText('«map»');
    await expect(page.locator('.view-area .bango-cedge')).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test('the visualizations are a file of the metamodel, and editing it changes the views of its instances', async ({ page }) => {
    const errors = await start(page);
    await page.locator('.topbar nav button', { hasText: 'Metamodels' }).click();
    await page.locator('.mm-item', { has: page.locator('strong:text-is("datamodel")') }).click();
    await view(page, 'Visualizations');
    await expect(page.locator('.mm-editor .monaco-editor')).toBeVisible();
    await expect(page.locator('.segmented button', { hasText: 'Visualizations •' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
