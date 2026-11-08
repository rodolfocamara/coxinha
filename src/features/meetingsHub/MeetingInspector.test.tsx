import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { MeetingInspector } from './MeetingInspector';
import type { LibraryDetail } from '../meetings/library';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('../live/live', () => ({
  useLiveStatus: () => ({ live: false, elapsedMs: 0, meetingId: null }),
}));
vi.mock('../meetings/library', () => ({
  library: {
    available: vi.fn().mockReturnValue(true),
    participantContext: vi.fn().mockResolvedValue([]),
    signals: vi.fn().mockResolvedValue({ summariesOn: false, sessions: [] }),
    peekProcessing: vi.fn().mockResolvedValue(null),
  },
}));

let queryClient: QueryClient;

beforeEach(async () => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await i18n.changeLanguage('pt-BR');
});
afterEach(cleanup);

function makeDetail(directory: string): LibraryDetail {
  return {
    storage: {
      directory,
      totalBytes: 1024,
      durationMs: 60000,
      files: [],
    },
    meeting: {
      id: 'm1',
      title: 'Teste',
      started_at: '2026-11-03T10:00:00Z',
      ended_at: '2026-11-03T11:00:00Z',
    } as any,
    manifest: null,
    audio: null,
    inference: 'unavailable',
  };
}

function renderInspector(detail: LibraryDetail) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MeetingInspector
        start={new Date(2026, 10, 3, 10, 0)}
        end={new Date(2026, 10, 3, 11, 0)}
        now={new Date(2026, 10, 3, 12, 0)}
        event={null}
        source="recording"
        meetingId="m1"
        sessionId={null}
        detail={detail}
        live={false}
        liveElapsedMs={null}
        transcript="Transcrição"
        lanes={[]}
        participantsRevision={0}
        onAddParticipant={null}
        onImport={() => {}}
        onTranscribeAgain={null}
      />
    </QueryClientProvider>
  );
}

it('formats Linux directory paths with <wbr /> after / delimiters', () => {
  const linuxPath = '/home/user/coxinha/recordings';
  renderInspector(makeDetail(linuxPath));

  const folderRow = screen.getByTitle(linuxPath);
  expect(folderRow).toBeInTheDocument();
  expect(folderRow.textContent).toBe(linuxPath);
  expect(folderRow.querySelectorAll('wbr')).toHaveLength(4);
});

it('formats Windows directory paths with <wbr /> after \\ delimiters', () => {
  const windowsPath = 'C:\\Users\\user\\coxinha\\recordings';
  renderInspector(makeDetail(windowsPath));

  const folderRow = screen.getByTitle(windowsPath);
  expect(folderRow).toBeInTheDocument();
  expect(folderRow.textContent).toBe(windowsPath);
  expect(folderRow.querySelectorAll('wbr')).toHaveLength(4);
});
