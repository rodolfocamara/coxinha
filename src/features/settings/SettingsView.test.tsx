import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

const getConfig = vi.fn();
const listObsidianVaults = vi.fn();
const updateConfig = vi.fn();
const rebuildFromVault = vi.fn();

vi.mock('../../lib/bindings', () => ({
  commands: {
    getConfig: (...a: unknown[]) => getConfig(...a),
    listObsidianVaults: (...a: unknown[]) => listObsidianVaults(...a),
    updateConfig: (...a: unknown[]) => updateConfig(...a),
    rebuildFromVault: (...a: unknown[]) => rebuildFromVault(...a),
  },
}));

const loadNotes = vi.fn();
vi.mock('../../lib/store', () => ({
  useAppStore: <T,>(selector: (s: { loadNotes: typeof loadNotes }) => T) => selector({ loadNotes }),
}));

import { SETTINGS_SECTIONS } from './settingsIndex';
import { SettingsView } from './SettingsView';
import { THEME_STORAGE_KEY } from '../../lib/theme';

const BASE_CONFIG = {
  vault_path: 'C:/Users/me/coxinha',
  locale: '',
  transcriber: { engine: 'none' },
  diarizer: { engine: 'none' },
  llm: { kind: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2:3b' },
  autostart: false,
  shortcuts: {
    new_note: 'Ctrl+Alt+Y',
    open_app: 'Ctrl+Alt+O',
    agenda: 'Ctrl+Alt+G',
    meetings: 'Ctrl+Alt+T',
    toggle_recording: 'Ctrl+Alt+W',
  },
};

beforeEach(() => {
  getConfig.mockReset();
  listObsidianVaults.mockReset();
  updateConfig.mockReset();
  rebuildFromVault.mockReset();
  loadNotes.mockReset();
});

describe('SettingsView — vault panel', () => {
  it('renders the empty-state when no Obsidian vaults are detected', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });

    render(<SettingsView section="storage" />);

    await waitFor(() => expect(screen.getByText('settings.vault.noObsidian')).toBeInTheDocument());
    expect(screen.getByText('C:/Users/me/coxinha')).toBeInTheDocument();
  });

  it('lists detected vaults with switching disabled until storage supports migration', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'v1',
          name: 'Work',
          path: 'C:/Users/me/Documents/Work',
          last_opened_ms: Date.now() - 3600_000,
          exists: true,
        },
      ],
    });

    render(<SettingsView section="storage" />);

    await userEvent.click(await screen.findByText('settings.vault.otherFolders'));
    const radio = await screen.findByRole('radio', { name: /Work/ });
    const save = screen.getByRole('button', { name: /settings\.vault\.save/ });

    expect(save).toBeDisabled();

    await userEvent.click(radio);

    expect(radio).not.toBeChecked();
    expect(radio).toBeDisabled();
    expect(save).toBeDisabled();
  });

  it('never pretends changing the configured path switched active storage', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'v1',
          name: 'Ideas',
          path: 'D:/Vaults/ideas',
          last_opened_ms: null,
          exists: true,
        },
      ],
    });
    updateConfig.mockResolvedValue({ status: 'ok', data: null });

    render(<SettingsView section="storage" />);

    await userEvent.click(await screen.findByText('settings.vault.otherFolders'));
    const radio = await screen.findByRole('radio', { name: /Ideas/ });
    await userEvent.click(radio);
    await userEvent.click(screen.getByRole('button', { name: /settings\.vault\.save/ }));

    expect(updateConfig).not.toHaveBeenCalled();
    expect(screen.getByText('settings.recovery.vaultSwitch')).toBeVisible();
  });

  it('surfaces load errors from getConfig in an alert', async () => {
    getConfig.mockResolvedValue({ status: 'error', error: 'boom' });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });

    render(<SettingsView section="storage" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('boom');
  });

  it('rebuilds the index, shows the stats, and reloads notes', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
    rebuildFromVault.mockResolvedValue({
      status: 'ok',
      data: { notes_indexed: 42, links_indexed: 7, notes_skipped: 0 },
    });

    render(<SettingsView section="storage" />);

    const button = await screen.findByRole('button', { name: /settings\.vault\.rebuild/ });
    await userEvent.click(button);

    await waitFor(() => expect(rebuildFromVault).toHaveBeenCalledOnce());
    expect(loadNotes).toHaveBeenCalledOnce();
    const status = await screen.findByText(/settings\.vault\.rebuiltSuccess/);
    expect(status.textContent).toContain('42');
    expect(status.textContent).toContain('7');
  });

  it('surfaces rebuild errors without touching the note store', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
    rebuildFromVault.mockResolvedValue({ status: 'error', error: 'disk full' });

    render(<SettingsView section="storage" />);

    await userEvent.click(await screen.findByRole('button', { name: /settings\.vault\.rebuild/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('disk full');
    expect(loadNotes).not.toHaveBeenCalled();
  });
});

describe('SettingsView — appearance panel', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
  });

  it('defaults to Auto when no preference is stored', async () => {
    render(<SettingsView />);
    const auto = await screen.findByRole('radio', { name: 'people.settings.theme.auto' });
    expect(auto).toBeChecked();
  });

  it('persists the chosen theme to localStorage and broadcasts the change', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const events: string[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail as string);
    window.addEventListener('coxinha:theme-pref-changed', listener);

    await user.click(await screen.findByRole('radio', { name: 'people.settings.theme.dark' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(events).toEqual(['dark']);

    window.removeEventListener('coxinha:theme-pref-changed', listener);
  });

  it('clears the stored value when Auto is chosen after an override', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<SettingsView />);

    await user.click(await screen.findByRole('radio', { name: 'people.settings.theme.auto' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe('SettingsView — shortcuts panel', () => {
  beforeEach(() => {
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
  });

  it('lists all five global shortcuts from the config', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });

    render(<SettingsView section="shortcuts" />);

    const { shortcuts } = BASE_CONFIG;
    expect(await screen.findByText(shortcuts.new_note)).toBeInTheDocument();
    expect(screen.getByText(shortcuts.open_app)).toBeInTheDocument();
    expect(screen.getByText(shortcuts.agenda)).toBeInTheDocument();
    expect(screen.getByText(shortcuts.meetings)).toBeInTheDocument();
    expect(screen.getByText(shortcuts.toggle_recording)).toBeInTheDocument();

    expect(screen.getByText('settings.shortcuts.action.new_note')).toBeInTheDocument();
    expect(screen.getByText('people.settings.shortcuts.toggleRecording')).toBeInTheDocument();
  });

  it('reflects a non-default binding from the saved config', async () => {
    getConfig.mockResolvedValue({
      status: 'ok',
      data: {
        ...BASE_CONFIG,
        shortcuts: { ...BASE_CONFIG.shortcuts, new_note: 'Ctrl+Shift+Space' },
      },
    });

    render(<SettingsView section="shortcuts" />);

    expect(await screen.findByText('Ctrl+Shift+Space')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl+Alt+Y')).not.toBeInTheDocument();
  });

  it('surfaces the "rebind coming soon" hint', async () => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });

    render(<SettingsView section="shortcuts" />);

    expect(await screen.findByText('settings.shortcuts.rebindComingSoon')).toBeInTheDocument();
  });
});

it('recovers from rejected IPC promises with explicit retry', async () => {
  getConfig
    .mockRejectedValueOnce(new Error('IPC transport unavailable'))
    .mockResolvedValueOnce({ status: 'ok', data: BASE_CONFIG });
  listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
  render(<SettingsView section="storage" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.recovery.loadError');
  await userEvent.click(screen.getByRole('button', { name: 'settings.recovery.retry' }));
  expect(await screen.findByText(BASE_CONFIG.vault_path)).toBeVisible();
  expect(getConfig).toHaveBeenCalledTimes(2);
});

it.each([
  ['note_file_identity_conflict', 'settings.rebuildErrors.identityConflict'],
  ['note_file_invalid_metadata', 'settings.rebuildErrors.invalidMetadata'],
])('localizes known preflight refusal %s without rebuilding automatically', async (code, key) => {
  getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
  listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
  rebuildFromVault.mockResolvedValue({ status: 'error', error: code });
  render(<SettingsView section="storage" />);
  const button = await screen.findByRole('button', { name: 'settings.vault.rebuild' });
  expect(rebuildFromVault).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(key);
  expect(screen.getByRole('alert')).not.toHaveTextContent(code);
  expect(loadNotes).not.toHaveBeenCalled();
});

describe('SettingsView — section list and landing', () => {
  beforeEach(() => {
    getConfig.mockResolvedValue({ status: 'ok', data: BASE_CONFIG });
    listObsidianVaults.mockResolvedValue({ status: 'ok', data: [] });
  });

  it('lists every page as a link in its group and keeps the legacy heading anchors', async () => {
    render(<SettingsView />);
    const nav = screen.getByRole('navigation', { name: 'people.settings.sectionsLabel' });
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(SETTINGS_SECTIONS.map((id) => `people.settings.sections.${id}`));
    await screen.findByText(BASE_CONFIG.vault_path);
    for (const id of [
      'appearance-heading',
      'detection-heading',
      'integrations-heading',
      'vault-heading',
      'shortcuts-heading',
      'rebuild-heading',
      'diagnostics-heading',
    ])
      expect(document.getElementById(id), id).not.toBeNull();
  });

  it.each([
    ['integrations', 'people.settings.sections.integrations'],
    ['recording', 'people.settings.sections.recording'],
    ['storage', 'people.settings.sections.storage'],
  ] as const)('opens on %s: focuses the title and marks it current', async (section, label) => {
    render(<SettingsView section={section} />);
    await screen.findByText(BASE_CONFIG.vault_path);
    const heading = screen.getByRole('heading', { level: 1, name: label });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading.closest('section')).toHaveAttribute('id', section);
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('focuses the rebuild row for the note-recovery link', async () => {
    render(<SettingsView section="storage" target="rebuild-heading" />);
    const heading = await screen.findByRole('heading', { name: 'settings.vault.rebuildHeading' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('link', { name: 'people.settings.sections.storage' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
