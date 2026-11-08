import { dialogs, idle, onBoard, onCalendar, paletteOpen, pathname } from './common.mjs';

export const appProbes = {
  'app.palette': async (t) => {
    const page = await t.open('/meetings');
    await idle(page, 800);
    await t.press(page);
    await idle(page);
    t.check('opens', (await paletteOpen(page)) === 1);
    await t.press(page);
    await idle(page);
    t.check('closes', (await paletteOpen(page)) === 0);
  },
  'app.help': async (t) => {
    const page = await onBoard(t);
    await t.press(page);
    const sheet = page.getByRole('dialog');
    await sheet.waitFor();
    t.check('lists the board on the board', (await sheet.locator('[data-shortcut-scope="board"]').count()) === 1);
    t.check('leaves the calendar out', (await sheet.locator('[data-shortcut-scope="calendar"]').count()) === 0);
    t.check('lists system chords', (await sheet.locator('[data-shortcut="system.meetings"] kbd').innerText()) === 'Ctrl+Alt+T');
    await page.keyboard.press('Escape');
    await idle(page);
    t.check('Esc closes it', (await dialogs(page)) === 0);
    const cal = await onCalendar(t);
    await t.press(cal);
    const other = cal.getByRole('dialog');
    await other.waitFor();
    t.check('lists the calendar on the calendar', (await other.locator('[data-shortcut="calendar.today"]').count()) === 1);
    t.check('leaves the board out', (await other.locator('[data-shortcut-scope="board"]').count()) === 0);
    await cal.keyboard.press('Escape');
    await idle(cal);
    await cal.getByRole('button', { name: /search/i }).first().click();
    await cal.waitForSelector('[role="dialog"] [role="combobox"]');
    await t.press(cal);
    await idle(cal);
    t.check('stays out of a text field', (await cal.locator('[data-shortcut-scope]').count()) === 0);
  },
  'app.undoTrash': async (t) => {
    const page = await t.open('/meetings');
    await idle(page, 800);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('[role="dialog"] [role="combobox"]');
    await idle(page);
    const before = await page.locator('[role="option"]').count();
    await page.getByRole('button', { name: /delete/i }).first().click();
    await idle(page);
    t.check('the palette offers the undo', (await page.getByRole('status').filter({ hasText: /trash/i }).count()) === 1);
    t.check('without asking through window.confirm', (await page.getByRole('option').count()) === before - 1);
    await page.keyboard.press('Escape');
    await idle(page);
    await t.press(page);
    await idle(page);
    t.check('it restores the note', (await page.evaluate(() => window.__cxCalls.includes('restore_note'))));
  },
  'palette.move': async (t) => {
    const page = await t.open('/meetings');
    await idle(page, 800);
    await page.keyboard.press('Control+k');
    const field = page.locator('[role="dialog"] [role="combobox"]');
    await field.waitFor();
    await idle(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await idle(page, 100);
    const before = await field.getAttribute('aria-activedescendant');
    await t.press(page);
    await idle(page, 100);
    t.check('the cursor moves', (await field.getAttribute('aria-activedescendant')) !== before);
  },
  'palette.open': async (t) => {
    const page = await t.open('/meetings');
    await idle(page, 800);
    await page.keyboard.press('Control+k');
    const field = page.locator('[role="dialog"] [role="combobox"]');
    await field.waitFor();
    await idle(page);
    await page.keyboard.type('People');
    await idle(page);
    await t.press(page);
    await idle(page, 600);
    t.check('opens the result', (await pathname(page)) === '/people', await pathname(page));
  },
  'palette.delete': async (t) => {
    const page = await t.open('/meetings');
    await idle(page, 800);
    await page.keyboard.press('Control+k');
    const field = page.locator('[role="dialog"] [role="combobox"]');
    await field.waitFor();
    await idle(page);
    const title = await page.evaluate(async () => (await window.__cxFixtures.list_notes({}, window.__cxState))[0].title);
    await page.keyboard.type(title.slice(0, 12));
    await idle(page, 500);
    await t.press(page);
    await idle(page);
    t.check('moves it to the trash', await page.evaluate(() => window.__cxCalls.includes('delete_note')));
  },
};
