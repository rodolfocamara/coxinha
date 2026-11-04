#!/usr/bin/env node
/**
 * Spec 0117 P1, in a real browser: the opt-in by keyboard, photos with alt text,
 * initials as the fallback, and no request to Microsoft from the page.
 *
 *   COXINHA_URL=http://localhost:14255 pnpm test:person-photos [--engine webkit]
 */
import { devServer, launch, openApp } from './harness.mjs';

const at = process.argv.indexOf('--engine');
const engine = at > 0 ? process.argv[at + 1] : 'chromium';
const VIEWPORT = { width: 1200, height: 800 };
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const server = await devServer();
const browser = await launch(engine);
const outside = [];
const open = async (route, state) => {
  const opened = await openApp(browser, {
    url: server.url,
    route,
    viewport: VIEWPORT,
    state,
  });
  opened.page.on('request', (request) => {
    if (/microsoft/i.test(new URL(request.url()).hostname)) outside.push(request.url());
  });
  await opened.page.waitForTimeout(800);
  return opened;
};
const images = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => img.src.startsWith('data:image/') && img.alt !== 'Coxinha')
      .map((img) => ({ alt: img.alt, width: img.naturalWidth }))
  );
const calls = (page) => page.evaluate(() => window.__cxState.photoCalls ?? []);
try {
  {
    const { page, context, errors } = await open('/people');
    check('off: no photo is shown in People', (await images(page)).length === 0);
    check('off: no photo is read', (await calls(page)).length === 0);
    check('off: initials stay', (await page.getByText('RS', { exact: true }).count()) > 0);
    check('no page errors', errors.length === 0, errors.join('; '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('/people', { photosOn: true });
    const shown = await images(page);
    check('on: photos load in People', shown.length === 2 && shown.every((i) => i.width === 48));
    check(
      'on: each photo has useful alt text',
      shown.some((i) => i.alt === 'Foto de Rita Souza'),
      shown.map((i) => i.alt).join(', ')
    );
    check(
      'on: someone without a photo keeps initials',
      await page.getByText('ML', { exact: true }).isVisible()
    );
    check('no page errors', errors.length === 0, errors.join('; '));
    await context.close();
  }
  {
    const { page, context } = await open('/meetings/s-rita', { photosOn: true });
    const shown = await images(page);
    check(
      'on: the meeting shows the photo beside the name',
      shown.some((i) => i.width === 48),
      `${shown.length} shown`
    );
    await context.close();
  }
  {
    const { page, context, errors } = await open('/settings/calendar');
    const toggle = page.getByRole('checkbox', { name: 'Fotos dos convidados' });
    check('the opt-in starts off', !(await toggle.isChecked()));
    check(
      'opening the page asks for nothing',
      !(await calls(page)).some((c) => c.startsWith('calendar_begin'))
    );
    await toggle.focus();
    check('reachable by keyboard', await toggle.evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const sequence = await calls(page);
    check(
      'turning it on asks for the photos',
      sequence.includes('calendar_begin true'),
      sequence.join(', ')
    );
    check('and turns on when the sign-in completes', await toggle.isChecked());
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    check('turning it off deletes', (await calls(page)).includes('directory_photos_disable'));
    check('and it is off again', !(await toggle.isChecked()));
    check('no page errors', errors.length === 0, errors.join('; '));
    await context.close();
  }
  check('the page itself never talks to Microsoft', outside.length === 0, outside.join(', '));
} finally {
  await browser.close();
  server.stop();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
