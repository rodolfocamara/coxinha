import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { SessionRecording } from './SessionRecording';
import type { Session } from './sessions';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../meetings/RecordingDetail', () => ({ RecordingDetail: () => null }));
afterEach(cleanup);
it('starts only after a click with the actual OS-default mic and monitor, then locks device changes', async () => {
  await i18n.changeLanguage('en');
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'library_sources')
      return [
        { name: 'webcam', description: 'Webcam', monitor: false },
        { name: 'vocaster-usb5', description: 'Vocaster mic', monitor: false, is_default: true },
        {
          name: 'vocaster-usb2.monitor',
          description: 'Vocaster speakers',
          monitor: true,
          is_default: true,
        },
      ];
    if (command === 'library_status') return { active: null, error: null };
    if (command === 'library_start_session')
      return {
        active: {
          meetingId: 'default-capture',
          paused: false,
          elapsedMs: 0,
          mic: { peak: 0, lastBlockMs: null, error: null },
          output: { peak: 0, lastBlockMs: null, error: null },
        },
        error: null,
      };
    throw new Error(command);
  });
  render(
    <SessionRecording
      session={
        {
          id: 'default-session',
          title: 'Default devices',
          meeting_id: null,
          recording: null,
        } as Session
      }
      transcript={false}
      refresh={async () => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  );
  expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveTextContent(
    'Vocaster mic · System default'
  );
  expect(invoke).not.toHaveBeenCalledWith('library_start_session', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('library_start_session', {
      sessionId: 'default-session',
      micSource: 'vocaster-usb5',
      outputSource: 'vocaster-usb2.monitor',
    })
  );
  expect(screen.getByRole('button', { name: 'Use system defaults' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refresh devices' })).toBeDisabled();
});
