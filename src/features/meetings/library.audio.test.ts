import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset:${path}`),
}));
vi.mock('@tauri-apps/api/core', () => ({ ...api, isTauri: () => true }));
const url = `http://127.0.0.1:34567/audio/${'ab'.repeat(32)}.wav`;
const detail = (value: string) => ({ meeting: { id: 'fixture' }, audio: { imported: value } });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it.each(['detail', 'recover', 'importAudio'] as const)(
  '%s preserves granted loopback URLs without asset conversion',
  async (operation) => {
    const { library } = await import('./library');
    api.invoke.mockResolvedValue(detail(url));
    await library[operation]('fixture', '/fixture.wav');
    expect(library.audioUrl(url)).toBe(url);
    expect(api.convertFileSrc).not.toHaveBeenCalled();
    expect(() => library.audioUrl(url.replace('/audio/', '/private/'))).toThrow('not granted');
  }
);

it.each([
  'https://example.com/audio.wav',
  'http://localhost:34567/audio/x.wav',
  url.replace('127.0.0.1', '0.0.0.0'),
  url.replace('34567', '65536'),
  url + '?path=/private/profiles.db',
  url + '#fragment',
  url.replace('/audio/', '/audio/%2e%2e/'),
  url.replace('http://', 'asset://'),
  'blob:fixture',
  'file:///private/profiles.db',
  '../private/profiles.db',
])('rejects unexpected transport %s', async (value) => {
  const { library } = await import('./library');
  api.invoke.mockResolvedValue(detail(value));
  await expect(library.detail('fixture')).rejects.toThrow('audio transport');
  expect(() => library.audioUrl(value)).toThrow('not granted');
  expect(api.convertFileSrc).not.toHaveBeenCalled();
});

it('pins the authority and requires an IPC grant even for well-shaped URLs', async () => {
  const { library } = await import('./library');
  expect(() => library.audioUrl(url)).toThrow('not granted');
  api.invoke.mockResolvedValue(detail(url));
  await library.detail('fixture');
  const other = url.replace('34567', '34568');
  api.invoke.mockResolvedValue(detail(other));
  await expect(library.detail('other')).rejects.toThrow('Unexpected');
  expect(library.audioUrl(url)).toBe(url);
  expect(() => library.audioUrl(other)).toThrow('not granted');
});

it.each([
  String.raw`C:\owned\raw\mic.wav`,
  String.raw`\\?\C:\owned\raw\mic.wav`,
  String.raw`\\server\share\raw\mic.wav`,
])(
  'preserves scoped asset playback for legacy platform path %s and handles absent audio',
  async (path) => {
    const { library } = await import('./library');
    api.invoke.mockResolvedValue(detail(path));
    await library.detail('fixture');
    expect(library.audioUrl(path)).toBe(`asset:${path}`);
    api.invoke.mockResolvedValue({ audio: null });
    await library.recover('fixture');
    expect(() => library.audioUrl('/unknown/private.wav')).toThrow('not granted');
  }
);
