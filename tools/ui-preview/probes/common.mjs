// What the shortcut probes share: how to reach a screen and read its state.
export const idle = (page, ms = 350) => page.waitForTimeout(ms);
export const dialogs = (page) => page.getByRole('dialog').count();
export const paletteOpen = (page) => page.locator('[role="dialog"] [role="combobox"]').count();

export const onBoard = async (t) => {
  const page = await t.open('/workspace');
  await page.waitForSelector('.react-flow__node-card');
  await idle(page, 500);
  return page;
};
export const nodes = (page) => page.locator('.react-flow__node').count();
export const clickNode = async (page, kind) => {
  const box = await page.locator(`.react-flow__node-${kind}`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + (kind === 'area' ? 12 : box.height / 2));
  await idle(page);
};
export const inNote = async (t) => {
  const page = await onBoard(t);
  await clickNode(page, 'card');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
  await page.locator('[contenteditable="true"]').first().click();
  return page;
};
export const onCalendar = async (t, view = 'week') => {
  const page = await t.open(`/meetings?view=${view}`);
  await page.waitForSelector('.ch-title');
  await idle(page, 500);
  return page;
};
export const rangeLabel = (page) => page.locator('.ch-title').innerText();
export const viewParam = (page) => page.evaluate(() => window.__coxinha.router.state.location.search.view);
export const pathname = (page) => page.evaluate(() => window.__coxinha.router.state.location.pathname);

export const onSystemRow = async (t, action) => {
  const page = await t.open('/settings/shortcuts');
  const row = page.locator(`.cx-settings-row:has(#shortcut-${action}-title)`);
  await row.waitFor();
  await idle(page, 300);
  return { page, row };
};
