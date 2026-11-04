import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { SETTINGS_GROUPS, SETTINGS_ROWS, SETTINGS_SECTIONS } from './settingsIndex';
import { mockSettingsBackend, renderSettingsAt } from './settingsPages.harness';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const tr = (key: string) => i18n.t(key);
const pageName = (section: string) => tr(`people.settings.sections.${section}`);
const pageTitle = (section: string) =>
  screen.findByRole('heading', { level: 1, name: pageName(section) });
const pageLink = (section: string) => screen.getByRole('link', { name: pageName(section) });

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  localStorage.clear();
  mockSettingsBackend();
});
afterEach(cleanup);

describe('one page', () => {
  it.each([...SETTINGS_SECTIONS])('%s shows alone, with a title and a description', async (id) => {
    renderSettingsAt(`/settings/${id}`);
    await screen.findByText('/fixture/vault');
    const title = await pageTitle(id);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const page = title.closest('section')!;
    expect(page).toHaveAttribute('id', id);
    expect(within(page).getByText(tr(`people.settings.descriptions.${id}`))).toBeVisible();
    for (const other of SETTINGS_SECTIONS.filter((section) => section !== id))
      expect(document.getElementById(other)).not.toBeVisible();
  });
});

describe('sidebar', () => {
  it('names the groups in order and marks only the current page', async () => {
    renderSettingsAt('/settings/recording');
    await pageTitle('recording');
    const nav = screen.getByRole('navigation', { name: tr('people.settings.sectionsLabel') });
    const lists = within(nav).getAllByRole('list');
    expect(lists).toHaveLength(SETTINGS_GROUPS.length);
    SETTINGS_GROUPS.forEach((group, index) => {
      expect(lists[index]).toHaveAccessibleName(tr(`people.settings.groups.${group.id}`));
      expect(
        within(lists[index])
          .getAllByRole('link')
          .map((link) => link.textContent)
      ).toEqual(group.sections.map(pageName));
    });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toEqual([pageLink('recording')]);
  });

  it('works from the keyboard and moves focus to the new page title', async () => {
    const user = userEvent.setup();
    const router = renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    pageLink('storage').focus();
    await user.keyboard('{Enter}');
    const title = await pageTitle('storage');
    await waitFor(() => expect(title).toHaveFocus());
    expect(router.state.location.pathname).toBe('/settings/storage');
    expect(pageLink('storage')).toHaveAttribute('aria-current', 'page');
  });
});

describe('window title', () => {
  it('follows the section and comes back on leaving', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/recording');
    await pageTitle('recording');
    expect(document.title).toBe(
      `${pageName('recording')} · ${tr('people.settings.title')} · ${tr('brand.name')}`
    );
    await user.click(pageLink('calendar'));
    await pageTitle('calendar');
    expect(document.title).toContain(pageName('calendar'));
    await user.click(screen.getByRole('link', { name: 'leave settings' }));
    await screen.findByText('outside');
    expect(document.title).toBe(tr('brand.name'));
  });
});

describe('keeps', () => {
  it('a half-typed field, unsaved, while away, and saves it on the way', async () => {
    const saved: unknown[] = [];
    mockSettingsBackend({
      set_title_llm_settings: (args) => {
        saved.push((args as { settings: unknown }).settings);
        return (args as { settings: unknown }).settings;
      },
    });
    const user = userEvent.setup();
    renderSettingsAt('/settings/titles');
    const field = await screen.findByRole('textbox', { name: tr('people.settings.titles.target') });
    await user.clear(field);
    await user.type(field, 'half@typed');
    await user.click(pageLink('storage'));
    await pageTitle('storage');
    await user.click(pageLink('titles'));
    await pageTitle('titles');
    expect(screen.getByRole('textbox', { name: tr('people.settings.titles.target') })).toHaveValue(
      'half@typed'
    );
    await waitFor(() =>
      expect(saved).toEqual([expect.objectContaining({ sshTarget: 'half@typed' })])
    );
  });

  it('the open details and each page own scroll', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    const appearance = document.getElementById('appearance')!;
    appearance.scrollTop = 120;
    fireEvent.scroll(appearance);
    await user.click(pageLink('storage'));
    await pageTitle('storage');
    const details = document.querySelector<HTMLDetailsElement>('details.settings-advanced')!;
    details.open = true;
    await user.click(pageLink('appearance'));
    await pageTitle('appearance');
    expect(appearance.scrollTop).toBe(120);
    expect(details.open).toBe(true);
  });
});

describe('the table', () => {
  it('names only rows that exist, on the page it says', async () => {
    renderSettingsAt('/settings/titles');
    await screen.findByRole('textbox', { name: tr('people.settings.titles.target') });
    await screen.findByText('/fixture/vault');
    await waitFor(() => expect(document.getElementById('live-model-title')).not.toBeNull());
    for (const row of SETTINGS_ROWS) {
      const element = document.getElementById(row.anchor);
      expect(element, row.anchor).not.toBeNull();
      expect(element!.closest('[data-settings-section]'), row.anchor).toHaveAttribute(
        'id',
        row.section
      );
      expect(element!.textContent, row.anchor).toContain(i18n.t(row.title));
    }
  });
});

describe('moves', () => {
  it('puts titles and summaries on their own page, out of Integrations', async () => {
    renderSettingsAt('/settings/integrations');
    await pageTitle('integrations');
    await waitFor(() => expect(document.getElementById('summaries-heading')).not.toBeNull());
    const integrations = document.getElementById('integrations')!;
    const titles = document.getElementById('titles')!;
    expect(within(integrations).queryByText(tr('people.settings.titles.summaries'))).toBeNull();
    expect(titles).toContainElement(document.getElementById('titles-heading'));
    expect(titles).toContainElement(document.getElementById('summaries-heading'));
    expect(document.getElementById('integrations')).toContainElement(
      document.getElementById('integrations-outlook-heading')
    );
  });

  it('keeps the same call for a moved switch', async () => {
    const sent: unknown[] = [];
    mockSettingsBackend({
      title_llm_settings: () => ({
        enabled: true,
        sshTarget: 'x@y',
        remotePort: 1,
        model: 'm',
        summaries: false,
      }),
      set_title_llm_settings: (args) => {
        sent.push((args as { settings: unknown }).settings);
        return (args as { settings: unknown }).settings;
      },
    });
    const user = userEvent.setup();
    renderSettingsAt('/settings/titles');
    await user.click(
      await screen.findByRole('checkbox', { name: tr('people.settings.titles.summaries') })
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { enabled: true, sshTarget: 'x@y', remotePort: 1, model: 'm', summaries: true },
      ])
    );
    expect(invoke).toHaveBeenCalledWith('set_title_llm_settings', expect.anything());
  });

  it('groups Appearance, with no title over a lone language row', async () => {
    renderSettingsAt('/settings/appearance');
    const page = (await pageTitle('appearance')).closest('section')!;
    expect(
      within(page)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
    ).toEqual([tr('people.settings.groups.themeAndColour'), tr('people.settings.groups.text')]);
    expect(page).toContainElement(document.getElementById('language-title'));
  });
});

describe('filter', () => {
  const box = () => screen.getByRole('combobox', { name: tr('people.settings.filter.label') });

  it('lists matches across pages in place of the sidebar', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    await user.type(box(), 'fuso');
    const list = screen.getByRole('listbox');
    expect(within(list).getByText(tr('people.settings.zones.title'))).toBeVisible();
    expect(within(list).getAllByText(pageName('calendar')).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('navigation', { name: tr('people.settings.sectionsLabel') })
    ).toBeNull();
    expect(screen.getByText(/ajustes? encontrados?/)).toBeInTheDocument();
  });

  it('opens the page and focuses the row from the keyboard', async () => {
    const user = userEvent.setup();
    const router = renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    box().focus();
    await user.keyboard('microfone');
    await waitFor(() =>
      expect(box()).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-0'))
    );
    await user.keyboard('{Enter}');
    await pageTitle('recording');
    expect(router.state.location.hash).toBe('mic-title');
    await waitFor(() => expect(document.getElementById('mic-title')).toHaveFocus());
    expect(box()).toHaveValue('');
    expect(
      screen.getByRole('navigation', { name: tr('people.settings.sectionsLabel') })
    ).toBeVisible();
  });

  it('moves with the arrows and clears with Escape', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    box().focus();
    await user.keyboard('fonte');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(box()).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says so when nothing matches, and refocuses a row picked twice', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/recording#mic-title');
    await pageTitle('recording');
    await user.type(box(), 'zzzz');
    expect(screen.getByText(tr('people.settings.filter.none'))).toBeVisible();
    await user.clear(box());
    await user.type(box(), 'microfone');
    await act(async () => fireEvent.click(screen.getAllByRole('option')[0]));
    await waitFor(() => expect(document.getElementById('mic-title')).toHaveFocus());
  });
});

describe('selector', () => {
  it('changes page like the sidebar, for the small window', async () => {
    const user = userEvent.setup();
    const router = renderSettingsAt('/settings/appearance');
    await pageTitle('appearance');
    const select = screen.getByRole('combobox', { name: tr('people.settings.sectionsLabel') });
    expect(select).toHaveTextContent(pageName('appearance'));
    await user.click(select);
    const groups = await screen.findAllByRole('group');
    expect(groups).toHaveLength(SETTINGS_GROUPS.length);
    await user.click(screen.getByRole('option', { name: pageName('storage') }));
    await pageTitle('storage');
    expect(router.state.location.pathname).toBe('/settings/storage');
  });
});
