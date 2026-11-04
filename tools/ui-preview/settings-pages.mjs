#!/usr/bin/env node
/**
 * Spec 0129, in a real browser: pages, sidebar and filter by keyboard, old links,
 * kept state and scroll, the small window's selector.
 *
 *   pnpm test:settings-pages [--shots /tmp/cx-settings-pages]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { devServer, launch, openApp } from './harness.mjs';

const at = process.argv.indexOf('--shots');
const shots = at > 0 ? process.argv[at + 1] : null;
if (shots) await mkdir(shots, { recursive: true });

const NORMAL = { width: 1200, height: 800 };
const SMALL = { width: 800, height: 600 };
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const pathname = (page) => page.evaluate(() => window.__coxinha.router.state.location.pathname);
const hash = (page) => page.evaluate(() => window.__coxinha.router.state.location.hash);
const focused = (page) =>
  page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const settle = (page) => page.waitForTimeout(350);

const server = await devServer();
const browser = await launch();
const open = async (route, viewport = NORMAL, extra = {}) => {
  const opened = await openApp(browser, { url: server.url, route, viewport, ...extra });
  await opened.page.waitForTimeout(600);
  return opened;
};
try {
  // One page, the sidebar by keyboard, focus on the title, history and window title.
  {
    const { page, context, errors } = await open('/settings');
    check('/settings opens the first page', (await pathname(page)) === '/settings/appearance');
    check('the page title takes focus', (await focused(page)) === 'appearance-heading');
    check('one h1 on screen', (await page.locator('h1:visible').count()) === 1);
    check(
      'the current page is marked',
      (await page.locator('a[aria-current="page"]').textContent()) === 'Aparência'
    );

    const storage = page.getByRole('link', { name: 'Armazenamento' });
    await storage.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    check('Enter opens the page', (await pathname(page)) === '/settings/storage');
    check('focus moves to its title', (await focused(page)) === 'vault-heading');
    check(
      'the window title follows',
      (await page.title()) === 'Armazenamento · Ajustes · Coxinha',
      await page.title()
    );
    await page.keyboard.press('Shift+Tab');
    const back = await page.evaluate(() => document.activeElement?.closest('nav')?.tagName);
    check('Shift+Tab from the title reaches the sidebar', back === 'NAV');

    await page.evaluate(() => window.__coxinha.router.history.back());
    await settle(page);
    check('back returns to the page', (await pathname(page)) === '/settings/appearance');
    await page.evaluate(() => window.__coxinha.router.history.forward());
    await settle(page);
    check('forward follows', (await pathname(page)) === '/settings/storage');
    check('no page errors', errors.length === 0, errors[0]);
    await context.close();
  }

  // The filter, from the keyboard only.
  {
    const { page, context } = await open('/settings/appearance');
    const box = page.getByRole('combobox', { name: 'Buscar um ajuste' });
    await box.focus();
    for (const [query, expected] of [
      ['fonte', 'Tamanho da fonte da interface'],
      ['fuso', 'Fusos horários extras'],
      ['microfone', 'Microfone'],
    ]) {
      await box.fill(query);
      const titles = await page.locator('.cx-settings-result-title').allTextContents();
      check(`"${query}" lists "${expected}"`, titles.includes(expected), titles.join(', '));
    }
    if (shots) {
      await box.fill('fonte');
      await page.keyboard.press('ArrowDown');
      await page.screenshot({ path: path.join(shots, 'filter.png') });
    }
    await box.fill('microfone');
    await page.keyboard.press('Enter');
    await settle(page);
    check('Enter opens its page', (await pathname(page)) === '/settings/recording');
    check('the row takes focus', (await focused(page)) === 'mic-title');
    const marked = await page.evaluate(
      () => getComputedStyle(document.activeElement.closest('.cx-settings-row')).backgroundColor
    );
    check('the row reads as chosen', marked !== 'rgba(0, 0, 0, 0)', marked);
    if (shots) await page.screenshot({ path: path.join(shots, 'row.png') });
    await box.fill('zzzz');
    check('nothing found says so', await page.getByText('Nenhum ajuste encontrado.').isVisible());
    await page.keyboard.press('Escape');
    check('Escape clears', (await box.inputValue()) === '');
    check('the sidebar is back', await page.getByRole('link', { name: 'Gravação' }).isVisible());
    await context.close();
  }

  // Ctrl+K reaches the same table.
  {
    const { page, context } = await open('/');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(250);
    await page.keyboard.type('microfone');
    await page.waitForTimeout(350);
    await page.getByRole('option', { name: /Microfone · Gravação/ }).click();
    await settle(page);
    check('Ctrl+K opens the row', (await hash(page)) === 'mic-title', await hash(page));
    check('the palette lands on its page', (await pathname(page)) === '/settings/recording');
    await context.close();
  }

  // Old links.
  {
    const links = {
      '/settings#appearance': ['/settings/appearance', 'appearance-heading'],
      '/settings#calendar': ['/settings/calendar', 'calendar-heading'],
      '/settings#recording': ['/settings/recording', 'recording-heading'],
      '/settings#transcription': ['/settings/transcription', 'transcription-heading'],
      '/settings#integrations': ['/settings/integrations', 'integrations-heading'],
      '/settings#shortcuts': ['/settings/shortcuts', 'shortcuts-heading'],
      '/settings#storage': ['/settings/storage', 'vault-heading'],
      '/settings#diagnostics': ['/settings/diagnostics', 'diagnostics-heading'],
      '/settings#appearance-heading': ['/settings/appearance', 'appearance-heading'],
      '/settings#integrations-heading': ['/settings/integrations', 'integrations-heading'],
      '/settings#vault-heading': ['/settings/storage', 'vault-heading'],
      '/settings#rebuild-heading': ['/settings/storage', 'rebuild-heading'],
      '/settings#detection-heading': ['/settings/recording', 'detection-heading'],
      '/settings#integrations-outlook-heading': [
        '/settings/integrations',
        'integrations-outlook-heading',
      ],
      '/settings#titles-heading': ['/settings/titles', 'titles-heading'],
      '/settings#summaries-heading': ['/settings/titles', 'summaries-heading'],
    };
    for (const [link, [where, element]] of Object.entries(links)) {
      const { page, context } = await open(link);
      const landed = await pathname(page);
      const on = await focused(page);
      const box = await page.evaluate((id) => {
        const rect = document.getElementById(id)?.getBoundingClientRect();
        return rect && rect.top >= 0 && rect.bottom <= innerHeight;
      }, element);
      check(`${link} lands`, landed === where && on === element && box, `${landed} ${on}`);
      await context.close();
    }
  }

  // A half-typed field and the scroll survive leaving and coming back.
  {
    const { page, context } = await open('/settings/transcription');
    const model = page.getByRole('textbox', { name: 'Modelo Tagarela' });
    await model.fill('/half/typed/path');
    await page.getByRole('link', { name: 'Atalhos' }).click();
    await settle(page);
    await page.getByRole('link', { name: 'Transcrição' }).click();
    await settle(page);
    check('the typed path is still there', (await model.inputValue()) === '/half/typed/path');

    const scrolled = await page.evaluate(() => {
      const box = document.getElementById('appearance');
      return box.id;
    });
    await page.getByRole('link', { name: 'Aparência' }).click();
    await settle(page);
    await page.evaluate((id) => {
      document.getElementById(id).scrollTop = 90;
    }, scrolled);
    await settle(page);
    await page.getByRole('link', { name: 'Diagnóstico' }).click();
    await settle(page);
    await page.getByRole('link', { name: 'Aparência' }).click();
    await settle(page);
    const top = await page.evaluate((id) => document.getElementById(id).scrollTop, scrolled);
    check('the page keeps its scroll', top === 90, String(top));
    await context.close();
  }

  // The small window: 800 x 600 at 20 has no room for the sidebar.
  {
    const { page, context } = await open('/settings/appearance', SMALL, {
      storage: { 'coxinha.appearance': JSON.stringify({ fontSize: 20 }) },
    });
    check('the sidebar folds', !(await page.locator('.cx-settings-nav').isVisible()));
    const select = page.getByRole('combobox', { name: 'Seções dos ajustes' });
    check('the selector shows the page', (await select.textContent())?.includes('Aparência'));
    await select.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    if (shots) await page.screenshot({ path: path.join(shots, 'selector.png') });
    await page.getByRole('option', { name: 'Armazenamento' }).click();
    await page.waitForTimeout(500);
    check('the selector opens the page', (await pathname(page)) === '/settings/storage');
    check(
      'focus moves to its title',
      (await focused(page)) === 'vault-heading',
      await focused(page)
    );
    const box = page.getByRole('combobox', { name: 'Buscar um ajuste' });
    await box.fill('fuso');
    if (shots) await page.screenshot({ path: path.join(shots, 'small-filter.png') });
    check('the filter works in the bar', await page.getByRole('listbox').isVisible());
    await context.close();
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
