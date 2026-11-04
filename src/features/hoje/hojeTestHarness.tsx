import { cleanup, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { initialCaptureState, useCaptureStore } from '../capture/captureStore';
import { sessionListCache, type Session } from '../sessions/sessions';
import type { Board } from '../board/model';

/**
 * Shared harness for the Hoje screen tests. Each test file declares the
 * module mocks (they are hoisted per file) and points them at these fakes:
 * router navigation, motion helpers and the board session.
 */
export const navigate = vi.fn();
export const motion = {
  prepareRouteTransition: vi.fn((kind: string) => `vt:${kind}`),
  setZoomOrigin: vi.fn(),
  nameForTransition: vi.fn(),
};
let currentBoard: unknown = null;
const boardListeners = new Set<() => void>();
export const boardSession = {
  async load() {
    currentBoard = await invoke('board_load');
    boardListeners.forEach((f) => f());
    return currentBoard;
  },
  subscribe: (f: () => void) => {
    boardListeners.add(f);
    return () => void boardListeners.delete(f);
  },
  get: () => currentBoard,
};

// Friday 30 Oct 2026, 09:00 local.
export const at = (days: number, h: number, m = 0) =>
  new Date(2026, 9, 30 + days, h, m).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const session = (o: Partial<Session> & { id: string; title: string }): Session => ({
  starts_at: null,
  ends_at: null,
  status: 'planned',
  origin: 'manual',
  meeting_id: null,
  personal_note: null,
  created_at: at(-1, 9),
  note_error: null,
  recording: null,
  transcript_status: 'none',
  processing_state: null,
  processing: null,
  ...o,
});
export const recording = (captureState: 'finished' | 'recording' = 'finished') => ({
  id: 'm-weekly',
  title: 'Weekly de TI',
  createdAt: at(0, 10),
  captureState,
});

export type Data = {
  sessions: Session[] | Error;
  calendar: unknown | Error;
  board: Board | Error;
  notes: unknown[] | Error;
};
export const data: { current: Data } = { current: undefined as unknown as Data };
export const fullBoard: Board = {
  version: 3,
  revision: 1,
  edges: [],
  items: [
    {
      id: 'a-crm',
      kind: 'area',
      x: 0,
      y: 0,
      width: 500,
      height: 400,
      color: 'blue',
      label: 'Migração do CRM',
      noteId: null,
      notePath: null,
    },
    {
      id: 'c-integ',
      kind: 'card',
      x: 40,
      y: 92,
      width: 210,
      height: 96,
      color: 'neutral',
      label: 'Levantar integrações',
      progress: 100,
      parentId: 'a-crm',
      noteId: 'n-integ',
      notePath: null,
    },
    {
      id: 'c-api',
      kind: 'card',
      x: 300,
      y: 180,
      width: 210,
      height: 96,
      color: 'neutral',
      label: 'Contrato de API v2',
      progress: 40,
      parentId: 'a-crm',
      noteId: 'n-api',
      notePath: null,
    },
    {
      id: 't-idea',
      kind: 'text',
      x: 10,
      y: 10,
      width: 210,
      height: 96,
      color: 'neutral',
      label: 'Ideia',
      noteId: 'n-idea',
      notePath: null,
    },
  ],
};
export const populated = (): Data => ({
  sessions: [
    session({
      id: 's-weekly',
      title: 'Weekly de TI',
      starts_at: at(0, 10),
      ends_at: at(0, 10, 45),
      status: 'active',
    }),
    session({
      id: 's-committee',
      title: 'Comitê de produto',
      starts_at: at(0, 14),
      ends_at: at(0, 15),
    }),
    session({
      id: 's-daily',
      title: 'Daily do squad',
      starts_at: at(-3, 9),
      ends_at: at(-3, 9, 15),
      recording: { ...recording(), id: 'm-daily' },
      meeting_id: 'm-daily',
    }),
    session({
      id: 's-interview',
      title: 'Entrevista: dev backend',
      starts_at: at(-4, 15),
      ends_at: at(-4, 16),
      recording: { ...recording(), id: 'm-int' },
      processing_state: 'failed',
      transcript_status: 'unavailable',
    }),
  ],
  calendar: {
    account: 'me@example.com',
    syncedAt: at(0, 8),
    events: [
      {
        id: 'e-weekly',
        title: 'Weekly de TI',
        startsAt: at(0, 10),
        endsAt: at(0, 10, 45),
        cancelled: false,
        allDay: false,
        attendees: [
          { name: 'Rita', email: 'rita@x' },
          { name: 'Marcos', email: 'm@x' },
        ],
      },
      {
        id: 'e-focus',
        title: 'Bloco de foco',
        startsAt: at(0, 16, 30),
        endsAt: at(0, 17),
        cancelled: false,
        allDay: false,
        attendees: [],
      },
    ],
  },
  board: fullBoard,
  notes: [
    {
      id: 'n-api',
      title: 'Contrato de API v2',
      path: 'a.md',
      tags: ['crm'],
      created_at: at(-2, 9),
      updated_at: at(0, 8, 12),
    },
    {
      id: 'n-old',
      title: 'Plano antigo',
      path: 'b.md',
      tags: [],
      created_at: at(-9, 9),
      updated_at: at(-9, 9),
    },
  ],
});
export const fresh = (): Data => ({
  sessions: [],
  calendar: { account: null, syncedAt: null, events: [] },
  board: { version: 3, revision: 0, items: [], edges: [] },
  notes: [],
});

export async function setupHoje() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
  await i18n.changeLanguage('pt-BR');
  navigate.mockReset();
  Object.values(motion).forEach((f) => f.mockClear());
  currentBoard = null;
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  useCaptureStore.setState({ ...initialCaptureState });
  useAppStore.setState({ notes: [] });
  data.current = populated();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    const pick = (v: unknown) => {
      if (v instanceof Error) throw v;
      return v;
    };
    if (command === 'library_sessions') return pick(data.current.sessions);
    if (command === 'calendar_status') return pick(data.current.calendar);
    if (command === 'board_load') return pick(data.current.board);
    if (command === 'list_notes') return pick(data.current.notes);
    throw new Error(`unexpected ${command}`);
  });
}
export function teardownHoje() {
  cleanup();
  vi.useRealTimers();
}

export const panel = (name: RegExp) => screen.getByRole('region', { name });
