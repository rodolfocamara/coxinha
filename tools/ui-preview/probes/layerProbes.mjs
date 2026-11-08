import { dialogs, idle, inNote, onCalendar, paletteOpen, pathname } from './common.mjs';

export const layerProbes = {
  'layer.close': async (t) => {
    const page = await inNote(t);
    await page.keyboard.press('Control+.');
    await idle(page);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('[role="dialog"] [role="combobox"]');
    await idle(page);
    const state = async () => ({
      palette: await paletteOpen(page),
      menu: await page.getByRole('menu').count(),
      editor: await page.locator('.ws-editor').count(),
    });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    t.check('all three open', same(await state(), { palette: 1, menu: 1, editor: 1 }));
    await t.press(page);
    await idle(page);
    t.check('one press closes the palette only', same(await state(), { palette: 0, menu: 1, editor: 1 }));
    await t.press(page);
    await idle(page);
    t.check('the next closes the menu only', same(await state(), { palette: 0, menu: 0, editor: 1 }));
    await t.press(page);
    await idle(page);
    t.check('the last closes the editor', same(await state(), { palette: 0, menu: 0, editor: 0 }));
    // The editor and Radix handle Esc themselves: each must count as the one layer closed.
    const nested = await inNote(t);
    await nested.keyboard.press('Control+End');
    await nested.keyboard.press('Enter');
    await nested.keyboard.type('/');
    const slash = nested.locator('.bn-suggestion-menu, [role="listbox"]').first();
    await slash.waitFor({ timeout: 5000 });
    await t.press(nested);
    await idle(nested);
    t.check('the editor slash menu closes first', (await slash.count()) === 0 && (await nested.locator('.ws-editor').count()) === 1);
    const select = nested.locator('.ws-editor button[role="combobox"]').first();
    await select.click();
    const popup = nested.getByRole('listbox');
    await popup.waitFor({ timeout: 5000 });
    await t.press(nested);
    await idle(nested);
    t.check('a select closes before its panel', (await popup.count()) === 0 && (await nested.locator('.ws-editor').count()) === 1);
    const cal = await onCalendar(t);
    await cal.locator('.mh-week-col button').first().click();
    await idle(cal);
    t.check('a block opens the peek', (await cal.locator('.ch-peek').count()) === 1);
    await cal.keyboard.press('n');
    await idle(cal);
    t.check('a sheet opens over it', (await dialogs(cal)) === 1);
    await t.press(cal);
    await idle(cal);
    t.check('Esc closes the sheet only', (await dialogs(cal)) === 0 && (await cal.locator('.ch-peek').count()) === 1);
    await t.press(cal);
    await idle(cal);
    t.check('Esc closes the peek', (await cal.locator('.ch-peek').count()) === 0);
  },
  'layer.cancelEdit': async (t) => {
    const page = await t.open('/settings/appearance');
    const filter = page.getByRole('combobox').first();
    await filter.waitFor();
    await filter.fill('theme');
    await idle(page);
    await t.press(page);
    await idle(page);
    t.check('clears the filter, nothing else', (await filter.inputValue()) === '' && (await pathname(page)) === '/settings/appearance');
  },
  'list.move': async (t) => {
    const horizontal = /Left|Right/.test(t.chord);
    if (horizontal) {
      const page = await t.open('/people');
      await page.waitForSelector('[role="tab"], .cx-settings-row, main');
      const week = await onCalendar(t);
      await week.locator('.mh-week-col button').first().dblclick();
      const tabs = week.getByRole('tab');
      await tabs.first().waitFor({ timeout: 15000 });
      await idle(week);
      await week.locator('[role="tab"][tabindex="0"]').focus();
      const before = await week.evaluate(() => document.activeElement?.id);
      await t.press(week);
      await idle(week);
      t.check('the tab bar moves', (await week.evaluate(() => document.activeElement?.id)) !== before);
      return;
    }
    const page = await onCalendar(t);
    await page.locator('.mh-cal-caret').click();
    const items = page.getByRole('menuitemradio');
    await items.first().waitFor();
    await idle(page, 100);
    await items.nth(3).focus();
    const before = await page.evaluate(() => document.activeElement?.textContent);
    await t.press(page);
    await idle(page, 100);
    t.check('the menu moves', (await page.evaluate(() => document.activeElement?.textContent)) !== before);
    await page.keyboard.press('Escape');
    await idle(page, 100);
    t.check('Esc closes the menu, focus back on its button', (await items.count()) === 0);
  },
  'list.pick': async (t) => {
    const page = await t.open('/settings/appearance');
    const filter = page.getByRole('combobox').first();
    await filter.waitFor();
    await filter.fill('microphone');
    await idle(page);
    await t.press(page);
    await idle(page, 500);
    t.check('opens the highlighted setting', (await pathname(page)) === '/settings/recording', await pathname(page));
  },
  'dialog.focusTrap': async (t) => {
    const page = await t.open('/');
    await idle(page, 800);
    await page.evaluate(() => {
      for (const command of [
        'desktop_flush_started',
        'desktop_flush_result',
        'desktop_recovery_shown',
        'desktop_recovery_presented',
        'desktop_diagnostic',
      ])
        window.__cxFixtures[command] = () => null;
      window.__cxEmit('desktop-flush', 'request');
    });
    await idle(page);
    await page.evaluate(() =>
      window.__cxEmit('desktop-recovery', {
        requestId: 'request',
        recoveryId: 'recovery',
        reason: 'save_failed',
      })
    );
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 5000 });
    await idle(page);
    const buttons = await dialog.getByRole('button').count();
    const seen = new Set();
    for (let i = 0; i < buttons + 1; i++) {
      seen.add(await page.evaluate(() => document.activeElement?.textContent));
      await t.press(page);
      await idle(page, 100);
    }
    t.check('focus stays in the dialog', await dialog.evaluate((el) => el.contains(document.activeElement)));
    t.check('and reaches every button', seen.size === buttons);
  },
};
