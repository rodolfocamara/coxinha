#!/usr/bin/env node
/**
 * Every in-app shortcut, pressed in a real browser with the real React Flow and
 * editor: `pnpm test:shortcuts`. Unit tests stub those two, which once hid that
 * Delete reached nothing. Prints one line per shortcut and exits 1 on a failure.
 */
import { devServer, launch, openApp } from './harness.mjs';

const server = await devServer(14289);
const browser = await launch();
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const open = (route) =>
  openApp(browser, {
    url: server.url,
    route,
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  });
const wait = (page, ms = 450) => page.waitForTimeout(ms);
const palette = (page) => page.locator('[role="dialog"] [role="combobox"]').count();

try {
  // Palette, from any screen.
  {
    const { page } = await open('/meetings');
    await wait(page, 900);
    for (const combo of ['Control+k', 'Control+p']) {
      await page.keyboard.press(combo);
      await wait(page);
      check(`${combo} opens the palette`, (await palette(page)) === 1);
      await page.keyboard.press('Escape');
      await wait(page);
      check(`Escape closes the palette opened by ${combo}`, (await palette(page)) === 0);
    }
  }

  // Board.
  {
    const { page, errors } = await open('/workspace');
    await page.waitForSelector('.react-flow__node-card');
    const nodes = () => page.locator('.react-flow__node').count();
    const edges = () => page.locator('.react-flow__edge').count();
    const select = async (kind) => {
      const box = await page.locator(`.react-flow__node-${kind}`).first().boundingBox();
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + (kind === 'area' ? 12 : box.height / 2)
      );
      await wait(page, 300);
    };
    const deselect = async () => {
      await page.keyboard.press('Escape');
      await wait(page, 200);
    };
    const total = await nodes();

    await select('card');
    await page.keyboard.press('Delete');
    await wait(page);
    check(
      'Delete removes the selected card',
      (await nodes()) === total - 1,
      `${total} -> ${await nodes()}`
    );
    await page.keyboard.press('Control+z');
    await wait(page);
    check('Ctrl+Z restores it', (await nodes()) === total);

    await deselect();
    await select('card');
    await page.keyboard.press('Backspace');
    await wait(page);
    check('Backspace removes the selected card', (await nodes()) === total - 1);
    await page.keyboard.press('Control+z');
    await wait(page);

    await deselect();
    await select('area');
    await page.keyboard.press('Delete');
    await wait(page);
    check('Delete removes the selected area', (await nodes()) === total - 1);
    await page.keyboard.press('Control+z');
    await wait(page);
    check('Ctrl+Z restores the area', (await nodes()) === total);

    await deselect();
    await select('area');
    const field = page.getByRole('textbox', { name: /area name/i });
    await field.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Delete');
    await page.keyboard.press('1');
    await wait(page);
    check('Delete and 1 in a text field stay in the text', (await nodes()) === total);
    await page.keyboard.press('Escape');
    await wait(page, 300);
    check('Escape closes the side editor', (await field.count()) === 0);

    await page.mouse.click(1000, 800);
    await wait(page, 300);
    const links = await edges();
    await page.locator('.react-flow__edge').first().dispatchEvent('click');
    await wait(page, 300);
    await page.keyboard.press('Delete');
    await wait(page);
    check(
      'Delete on a dependency removes only it',
      (await edges()) === links - 1 && (await nodes()) === total,
      `edges ${links} -> ${await edges()}`
    );

    for (const [key, what] of [
      ['1', 'note'],
      ['2', 'activity'],
      ['3', 'area'],
    ]) {
      const before = await nodes();
      await page.mouse.click(1000, 800);
      await page.keyboard.press(key);
      await wait(page);
      check(
        `${key} creates a ${what}`,
        (await nodes()) === before + 1,
        `${before} -> ${await nodes()}`
      );
      await page.keyboard.press('Escape');
      await wait(page, 300);
    }

    const real = errors.filter((e) => !e.includes('Transition was skipped'));
    check('board raised no page errors', real.length === 0, real.join('; '));
  }

  // Calendar peek.
  {
    const { page } = await open('/meetings?view=week');
    await page.waitForSelector('.mh-week-col [data-row], .mh-week-col button', { timeout: 15000 });
    await page.locator('.mh-week-col button').first().click();
    await wait(page);
    const panels = () => page.locator('.ch-peek').count();
    check('a block opens the peek', (await panels()) === 1);
    await page.keyboard.press('Escape');
    await wait(page);
    check('Escape closes the peek', (await panels()) === 0);
  }

  // Note menu: every hint it shows must do what it says.
  {
    const { page } = await open('/workspace');
    await page.waitForSelector('.react-flow__node-card');
    const box = await page.locator('.react-flow__node-card').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
    await page.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('Control+.');
    await wait(page);
    const menu = () => page.getByRole('menu').count();
    check('Ctrl+. opens the note menu', (await menu()) === 1);
    await page.keyboard.press('Escape');
    await wait(page);
    check('Escape closes the note menu', (await menu()) === 0);

    await page.evaluate(() => {
      window.__clip = [];
      navigator.clipboard.writeText = async (text) => void window.__clip.push(text);
    });
    await page.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('Control+l');
    await wait(page);
    check(
      'Ctrl+L copies the note link, as its menu hint says',
      (await page.evaluate(() => window.__clip.length)) === 1
    );
    const created = () => page.evaluate(() => window.__cxCreated ?? 0);
    const before = await created();
    await page.keyboard.press('Control+d');
    await wait(page);
    check('Ctrl+D duplicates the note, as its menu hint says', (await created()) === before + 1);
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
