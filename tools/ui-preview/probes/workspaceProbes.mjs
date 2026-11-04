import { clickNode, idle, inNote, nodes, onBoard } from './common.mjs';

export const workspaceProbes = {
  'note.menu': async (t) => {
    const page = await inNote(t);
    await t.press(page);
    await idle(page);
    t.check('opens the menu', (await page.getByRole('menu').count()) === 1);
    await t.press(page);
    await idle(page);
    t.check('closes the menu', (await page.getByRole('menu').count()) === 0);
  },
  'note.copyLink': async (t) => {
    const page = await inNote(t);
    await page.evaluate(() => {
      window.__clip = [];
      navigator.clipboard.writeText = async (text) => void window.__clip.push(text);
    });
    await t.press(page);
    await idle(page);
    t.check('copies a link', (await page.evaluate(() => window.__clip.length)) === 1);
  },
  'note.duplicate': async (t) => {
    const page = await inNote(t);
    const created = () => page.evaluate(() => window.__cxCreated ?? 0);
    const before = await created();
    await t.press(page);
    await idle(page);
    t.check('duplicates', (await created()) === before + 1);
  },
  'note.undo': async (t) => {
    const page = await inNote(t);
    const editor = page.locator('[contenteditable="true"]').first();
    const before = await editor.innerText();
    await page.keyboard.type('zzz');
    await idle(page);
    t.check('typed', (await editor.innerText()) !== before);
    await t.press(page);
    await idle(page);
    t.check('the editor undoes the typing', (await editor.innerText()) === before);
  },
  'board.remove': async (t) => {
    const page = await onBoard(t);
    const total = await nodes(page);
    await clickNode(page, 'card');
    await t.press(page);
    await idle(page);
    t.check('removes the selected card', (await nodes(page)) === total - 1);
    await page.keyboard.press('Control+z');
    await idle(page);
    await page.keyboard.press('Escape');
    await idle(page);
    await clickNode(page, 'area');
    await t.press(page);
    await idle(page);
    t.check('removes the selected area', (await nodes(page)) === total - 1);
    await page.keyboard.press('Control+z');
    await idle(page);
    await page.keyboard.press('Escape');
    await idle(page);
    await clickNode(page, 'area');
    const field = page.getByRole('textbox', { name: /area name/i });
    await field.focus();
    await page.keyboard.press('End');
    await t.press(page);
    await idle(page);
    t.check('stays in the text inside a field', (await nodes(page)) === total);
    await page.keyboard.press('Escape');
    await idle(page);
    await page.mouse.click(1000, 800);
    await idle(page);
    const edges = () => page.locator('.react-flow__edge').count();
    const links = await edges();
    await page.locator('.react-flow__edge').first().dispatchEvent('click');
    await idle(page);
    await t.press(page);
    await idle(page);
    t.check('removes only the dependency', (await edges()) === links - 1 && (await nodes(page)) === total);
  },
  'board.undo': async (t) => {
    const page = await onBoard(t);
    const total = await nodes(page);
    await clickNode(page, 'card');
    await page.keyboard.press('Delete');
    await idle(page);
    await t.press(page);
    await idle(page);
    t.check('restores the removal', (await nodes(page)) === total);
  },
  'board.newNote': async (t) => {
    const page = await onBoard(t);
    const before = await nodes(page);
    await page.mouse.click(1000, 800);
    await t.press(page);
    await idle(page);
    t.check('creates a note', (await nodes(page)) === before + 1);
  },
  'board.newActivity': async (t) => {
    const page = await onBoard(t);
    const before = await nodes(page);
    await page.mouse.click(1000, 800);
    await t.press(page);
    await idle(page);
    t.check('creates an activity', (await nodes(page)) === before + 1);
  },
  'board.newArea': async (t) => {
    const page = await onBoard(t);
    const before = await nodes(page);
    await page.mouse.click(1000, 800);
    await t.press(page);
    await idle(page);
    t.check('creates an area', (await nodes(page)) === before + 1);
  },
  'board.open': async (t) => {
    const page = await onBoard(t);
    await page.locator('.react-flow__node-card').first().focus();
    await t.press(page);
    await idle(page);
    t.check('opens the focused card', (await page.locator('.ws-editor').count()) === 1);
  },
};
