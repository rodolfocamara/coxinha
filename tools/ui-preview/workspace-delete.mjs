#!/usr/bin/env node
/**
 * Spec 0112 P3 against the real React Flow, which unit tests mock: Delete and
 * Backspace remove the selected item, undo brings it back, and a selected
 * dependency goes alone. Needs no running app.
 *
 *   node tools/ui-preview/workspace-delete.mjs
 */
import { devServer, launch, openApp } from './harness.mjs';

const server = await devServer(14289);
const browser = await launch();
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

try {
  const { page, errors } = await openApp(browser, {
    url: server.url,
    route: '/workspace',
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  });
  await page.waitForSelector('.react-flow__node-card');
  const nodes = () => page.locator('.react-flow__node').count();
  const edges = () => page.locator('.react-flow__edge').count();
  const select = async (kind) => {
    const box = await page.locator(`.react-flow__node-${kind}`).first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + (kind === 'area' ? 12 : box.height / 2));
    await page.waitForTimeout(300);
  };
  const settled = () => page.waitForTimeout(500);

  const total = await nodes();
  await select('card');
  await page.keyboard.press('Delete');
  await settled();
  check('Delete removes a selected card', (await nodes()) < total, `${total} -> ${await nodes()}`);
  await page.keyboard.press('Control+z');
  await settled();
  check('Ctrl+Z brings it back', (await nodes()) === total, `-> ${await nodes()}`);

  await page.keyboard.press('Escape');
  await select('card');
  await page.keyboard.press('Backspace');
  await settled();
  check('Backspace removes a selected card', (await nodes()) < total, `-> ${await nodes()}`);
  await page.keyboard.press('Control+z');
  await settled();

  await page.keyboard.press('Escape');
  await select('area');
  await page.keyboard.press('Delete');
  await settled();
  check('Delete removes a selected area', (await nodes()) === total - 1, `-> ${await nodes()}`);
  await page.keyboard.press('Control+z');
  await settled();
  check('Ctrl+Z brings the area back', (await nodes()) === total, `-> ${await nodes()}`);

  await page.keyboard.press('Escape');
  await page.mouse.click(5, 880);
  await settled();
  const links = await edges();
  if (links) {
    await page.locator('.react-flow__edge').first().dispatchEvent('click');
    await settled();
    await page.keyboard.press('Delete');
    await settled();
    check(
      'Delete removes only a selected dependency',
      (await edges()) === links - 1 && (await nodes()) === total,
      `edges ${links} -> ${await edges()}, nodes ${await nodes()}`
    );
  } else {
    check('fixture has a dependency', false);
  }
  // A view transition interrupted by the next click rejects; nothing breaks.
  const real = errors.filter((e) => !e.includes('Transition was skipped'));
  check('no page errors', real.length === 0, real.join('; '));
} finally {
  await browser.close();
  server.stop();
}
process.exit(failures.length ? 1 : 0);
