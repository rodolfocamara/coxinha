import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { SpeakerCard } from '../meetings/SpeakerCard';
import type { ProcessingReport } from '../meetings/library';
import { PersonAvatar as HubAvatar } from '../meetingsHub/PersonAvatar';
import { PersonAvatar } from './personVisual';
import { directoryPhotos, reloadPersonPhotos, resetPersonPhotos } from './personPhotos';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const report: ProcessingReport = {
  job: 'job',
  segments: [],
  turns: [],
  warnings: [],
  corrections: {},
  assignments: [
    {
      id: 'assignment',
      track: 'mic',
      speaker: 'speaker-1',
      person_id: 'p-ana',
      name: 'Ana Souza',
      state: 'confirmed',
    },
  ],
};
const card = {
  meetingId: 'm',
  curationVersion: report,
  track: 'mic',
  speaker: 'speaker-1',
  report,
  people: [{ id: 'p-ana', name: 'Ana Souza' }],
  recognition: null,
  disabled: false,
  act: async () => {},
  onSeek: () => {},
};
const SOURCE = 'data:image/png;base64,AAAA';
let index: { personId: string; name: string }[];

const asked = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === command).length;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetPersonPhotos();
  index = [{ personId: 'p-ana', name: 'Ana Souza' }];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'person_photo_index') return index;
    if (command === 'person_photo') {
      const id = (args as { personId: string }).personId;
      return index.some((p) => p.personId === id) ? SOURCE : null;
    }
    return null;
  });
});
afterEach(cleanup);

it('People shows the photo with a useful description', async () => {
  render(<PersonAvatar personId="p-ana" name="Ana Souza" />);
  const image = await screen.findByRole('img', { name: 'Photo of Ana Souza' });
  expect(image).toHaveAttribute('src', SOURCE);
});

it('the speaker card shows the photo of a confirmed speaker, else initials', async () => {
  const { rerender } = render(
    <ul>
      <SpeakerCard {...card} />
    </ul>
  );
  expect(await screen.findByRole('img', { name: 'Photo of Ana Souza' })).toBeVisible();
  index = [];
  act(() => reloadPersonPhotos());
  rerender(
    <ul>
      <SpeakerCard {...card} />
    </ul>
  );
  await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  expect(screen.getByText('AS')).toBeVisible();
});

it('People shows initials, hidden from screen readers, for someone without a photo', async () => {
  const { container } = render(<PersonAvatar personId="p-bruno" name="Bruno Lima" />);
  await waitFor(() => expect(asked('person_photo_index')).toBe(1));
  expect(screen.queryByRole('img')).toBeNull();
  expect(container.firstChild).toHaveTextContent('BL');
  expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  expect(asked('person_photo')).toBe(0);
});

it('a photo that fails to load falls back to the initials', async () => {
  const { container } = render(<PersonAvatar personId="p-ana" name="Ana Souza" />);
  fireEvent.error(await screen.findByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(container.firstChild).toHaveTextContent('AS');
});

it('invitee lists find the photo by name, ignoring case and accents', async () => {
  index = [{ personId: 'p-celia', name: 'Célia Souza' }];
  render(<HubAvatar name="celia  SOUZA" />);
  const image = await screen.findByRole('img', { name: /Photo of celia/i });
  expect(image).toHaveAttribute('src', SOURCE);
});

it('an invitee without a match keeps the initials', async () => {
  const { container } = render(<HubAvatar name="Bruno Lima" />);
  await waitFor(() => expect(asked('person_photo_index')).toBe(1));
  expect(screen.queryByRole('img')).toBeNull();
  expect(container.firstChild).toHaveTextContent('BL');
});

it('with the opt-in off nothing is read and initials stay', async () => {
  index = [];
  render(
    <>
      <PersonAvatar personId="p-ana" name="Ana Souza" />
      <HubAvatar name="Ana Souza" />
    </>
  );
  await waitFor(() => expect(asked('person_photo_index')).toBe(1));
  expect(asked('person_photo')).toBe(0);
  expect(screen.queryByRole('img')).toBeNull();
});

it('many avatars share one index and one read per person', async () => {
  render(
    <>
      <PersonAvatar personId="p-ana" name="Ana Souza" />
      <PersonAvatar personId="p-ana" name="Ana Souza" />
      <HubAvatar name="Ana Souza" />
    </>
  );
  expect(await screen.findAllByRole('img')).toHaveLength(3);
  expect(asked('person_photo_index')).toBe(1);
  expect(asked('person_photo')).toBe(1);
});

it('the opt-out takes the photos off the screen at once', async () => {
  render(<PersonAvatar personId="p-ana" name="Ana Souza" />);
  await screen.findByRole('img');
  index = [];
  await act(async () => {
    await directoryPhotos.disable();
  });
  expect(invoke).toHaveBeenCalledWith('directory_photos_disable');
  await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
});

it('a reply that arrives after the opt-out does not bring the photo back', async () => {
  let answer: (source: string) => void = () => {};
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'person_photo_index') return index;
    if (command === 'person_photo') return new Promise((resolve) => (answer = resolve));
    return null;
  });
  render(<PersonAvatar personId="p-ana" name="Ana Souza" />);
  await waitFor(() => expect(asked('person_photo')).toBe(1));
  index = [];
  act(() => reloadPersonPhotos());
  await waitFor(() => expect(asked('person_photo_index')).toBe(2));
  await act(async () => answer(SOURCE));
  expect(screen.queryByRole('img')).toBeNull();
});

it('a change event brings new photos in', async () => {
  index = [];
  render(<PersonAvatar personId="p-ana" name="Ana Souza" />);
  await waitFor(() => expect(asked('person_photo_index')).toBe(1));
  index = [{ personId: 'p-ana', name: 'Ana Souza' }];
  act(() => reloadPersonPhotos());
  expect(await screen.findByRole('img')).toHaveAttribute('src', SOURCE);
});
