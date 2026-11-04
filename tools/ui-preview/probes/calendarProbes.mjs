import { dialogs, idle, onCalendar, rangeLabel, viewParam } from './common.mjs';

export const calendarProbes = {
  'calendar.today': async (t) => {
    const page = await onCalendar(t);
    const today = await rangeLabel(page);
    await page.keyboard.press('j');
    await idle(page);
    await page.keyboard.press('j');
    await idle(page);
    t.check('moved away first', (await rangeLabel(page)) !== today);
    await t.press(page);
    await idle(page);
    t.check('comes back to today', (await rangeLabel(page)) === today);
  },
  'calendar.next': async (t) => {
    const page = await onCalendar(t);
    const before = await rangeLabel(page);
    await t.press(page);
    await idle(page);
    t.check('moves forward', (await rangeLabel(page)) !== before);
    await page.keyboard.press('k');
    await idle(page);
    t.check('k is its inverse', (await rangeLabel(page)) === before);
  },
  'calendar.previous': async (t) => {
    const page = await onCalendar(t);
    const before = await rangeLabel(page);
    await t.press(page);
    await idle(page);
    t.check('moves back', (await rangeLabel(page)) !== before);
    await page.keyboard.press('j');
    await idle(page);
    t.check('j is its inverse', (await rangeLabel(page)) === before);
  },
  'calendar.day': async (t) => {
    const page = await onCalendar(t, 'month');
    await t.press(page);
    await idle(page);
    t.check('shows the day', (await viewParam(page)) === 'day');
  },
  'calendar.week': async (t) => {
    const page = await onCalendar(t, 'month');
    await t.press(page);
    await idle(page);
    t.check('shows the week', (await viewParam(page)) === 'week');
  },
  'calendar.month': async (t) => {
    const page = await onCalendar(t);
    await t.press(page);
    await idle(page);
    t.check('shows the month', (await viewParam(page)) === 'month');
  },
  'calendar.new': async (t) => {
    const page = await onCalendar(t);
    await t.press(page);
    await idle(page);
    t.check('opens the new meeting sheet', (await dialogs(page)) === 1);
    await page.keyboard.press('Escape');
    await idle(page);
    t.check('Esc closes it', (await dialogs(page)) === 0);
  },
  'calendar.open': async (t) => {
    const page = await onCalendar(t);
    await page.waitForSelector('.mh-week-col button');
    await page.locator('.mh-week-col button').first().focus();
    await t.press(page);
    await idle(page, 800);
    t.check('opens the focused meeting', (await page.locator('.ch-title').count()) === 0);
  },
};
