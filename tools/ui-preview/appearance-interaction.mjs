#!/usr/bin/env node
/**
 * Spec 0125, in a real browser: settings reach the first paint, every appearance
 * control works from the keyboard alone, and the agenda's drag-to-create still
 * lands on the right time at the largest font size.
 *
 *   node tools/ui-preview/appearance-interaction.mjs [--engine chromium|webkit]
 */
import { devServer, launch, openApp } from './harness.mjs';

const engine = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'chromium';
const server = await devServer();
const browser = await launch(engine);
const viewport = { width: 1200, height: 800 };
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const rootPx = (page) => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('coxinha.appearance') ?? '{}'));
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return (
      el?.getAttribute('aria-label') ||
      el?.getAttribute('aria-labelledby') ||
      el?.textContent?.trim().slice(0, 30) ||
      el?.tagName
    );
  });

try {
  // First paint: the module that would apply the settings never runs.
  {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.route('**/src/main.tsx*', (route) => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('coxinha.appearance.css', 'html{font-size:20px}');
      localStorage.setItem('coxinha.themePref', 'dark');
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    check(
      'index.html applies the size with no app code',
      (await rootPx(page)) === '20px',
      await rootPx(page)
    );
    check(
      '...and the saved theme',
      await page.evaluate(() => document.documentElement.dataset.theme === 'dark')
    );
    await context.close();
  }

  // Survives a reload with the size the owner chose.
  {
    const { page, context } = await openApp(browser, {
      url: server.url,
      route: '/settings',
      viewport,
    });
    await page.waitForTimeout(500);
    const slider = page.getByRole('slider', { name: /fonte da interface/i });
    await slider.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
    check(
      'arrow keys raise the font size live',
      (await rootPx(page)) === '18px',
      await rootPx(page)
    );
    await page.keyboard.press('End');
    check('End jumps to the maximum', (await rootPx(page)) === '20px');
    await page.keyboard.press('Home');
    check('Home jumps to the minimum', (await rootPx(page)) === '12px');
    await page.keyboard.press('End');
    check('slider announces the value', (await slider.getAttribute('aria-valuetext')) === '20 px');

    await page.keyboard.press('Tab');
    const reset = page.getByRole('button', { name: /restaurar o tamanho/i });
    check(
      'Tab reaches the reset button',
      await reset.evaluate((el) => el === document.activeElement)
    );
    await page.keyboard.press('Enter');
    check('Enter resets to 16', (await rootPx(page)) === '16px');
    check(
      'focus returns to the slider',
      await slider.evaluate((el) => el === document.activeElement),
      await focused(page)
    );

    await page.keyboard.press('End');
    await page.reload();
    await page.waitForFunction(() => window.__coxinha?.router);
    check('the size survives a reload', (await rootPx(page)) === '20px');
    await page.keyboard.press('Home');
    await context.close();
  }

  // The whole section is reachable by Tab, in order.
  {
    const { page, context } = await openApp(browser, {
      url: server.url,
      route: '/settings',
      viewport,
    });
    await page.waitForTimeout(500);
    await page.getByRole('radio', { name: 'Automático' }).focus();
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          const inside = el.closest('.cx-settings-row');
          return `${el.getAttribute('role') ?? el.getAttribute('type') ?? el.tagName.toLowerCase()}:${inside?.querySelector('p,h3')?.textContent ?? ''}`;
        })
      );
    }
    for (const needle of [
      'Cor de destaque',
      'Contraste',
      'Tamanho da fonte',
      'Fonte da interface',
      'Fonte monoespaçada',
      'Idioma',
      'Fundo com gradiente',
    ])
      check(
        `Tab reaches ${needle}`,
        seen.some((entry) => entry.includes(needle))
      );

    // Accent by arrow keys, native radio behaviour.
    await page.getByRole('radio', { name: 'Tangerina' }).focus();
    await page.keyboard.press('ArrowRight');
    check(
      'arrows move the accent',
      (await stored(page)).accent === 'blue',
      (await stored(page)).accent
    );
    const accent = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      );
    check('the accent token follows', (await accent()) !== '0.77 0.135 55', await accent());
    await page.keyboard.press('End');
    await page.getByRole('radio', { name: 'Cor personalizada' }).focus();
    await page.keyboard.press('Space');
    check('custom is reachable', (await stored(page)).accent === 'custom');
    await page.getByLabel(/hexadecimal/).fill('#102060');
    const sample = page.locator('.cx-accent-sample');
    const ink = await sample.evaluate((el) => getComputedStyle(el).color);
    check(
      'a dark custom colour gets light text',
      /^rgb\((2[0-9]{2}), (2[0-9]{2}), (2[0-9]{2})\)$/.test(ink),
      ink
    );

    // Language by keyboard: Radix select opens with Enter, moves with arrows.
    await page.getByRole('combobox', { name: 'Idioma' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="option"]');
    // Radix moves focus into the list on the frame after opening.
    await page.waitForTimeout(250);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    check('language switches from the keyboard', (await stored(page)).language === 'en');
    check(
      'the window is now in English',
      (await page.getByRole('heading', { name: 'Appearance' }).count()) === 1
    );
    await context.close();
  }

  // Drag-to-create at the largest size: 60 real px per hour.
  {
    const { page, context } = await openApp(browser, {
      url: server.url,
      route: '/meetings?view=week',
      viewport,
      storage: { 'coxinha.appearance': JSON.stringify({ fontSize: 20 }) },
    });
    await page.waitForTimeout(600);
    const placed = await page.evaluate(() => {
      const hours = [...document.querySelectorAll('.mh-week-zone span')];
      return {
        hourGap: hours[1].getBoundingClientRect().top - hours[0].getBoundingClientRect().top,
      };
    });
    check(
      'one hour is 60 px at size 20',
      Math.abs(placed.hourGap - 60) < 0.5,
      String(placed.hourGap)
    );
    const column = page.locator('.mh-week-col').nth(4);
    const box = await column.boundingBox();
    const scrollTop = await page.evaluate(() => document.querySelector('.mh-week-grid').scrollTop);
    // 12:00 is 12 hours down the column; the column's top already accounts for the scroll.
    const y = box.y + 12 * 60;
    await page.mouse.move(box.x + 20, y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, y + 58, { steps: 4 });
    const draft = await page.locator('.mh-week-draft').textContent();
    await page.mouse.up();
    check(
      'dragging from 12:00 proposes 12:00 to 13:00',
      /12:00.*13:00/.test(draft ?? ''),
      `${draft}, scrolled ${scrollTop}`
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.stop();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
