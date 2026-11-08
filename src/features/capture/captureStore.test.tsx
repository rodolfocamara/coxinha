import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import { capturePhase, initialCaptureState, isSessionLive, useCaptureStore } from './captureStore';
import { LiveBadge } from './LiveBadge';

const meter = { peak: 0, lastBlockMs: null, error: null };
const active = (meetingId: string, paused = false) => ({
  active: { meetingId, paused, elapsedMs: 1000, mic: meter, output: meter },
  error: null,
});
const session = (id: string, meeting_id: string | null) => ({ id, meeting_id });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useCaptureStore.setState({ ...initialCaptureState });
});
afterEach(() => cleanup());

it('derives the phase from the live snapshot only', () => {
  expect(capturePhase(null)).toBe('idle');
  expect(capturePhase(active('m1'))).toBe('recording');
  expect(capturePhase(active('m1', true))).toBe('paused');
  expect(
    capturePhase({
      active: null,
      error: null,
      processing: { meetingId: 'm1', job: null, phase: 'inference' },
    })
  ).toBe('processing');
});

it('a session is live only while its meeting is the active capture', () => {
  const state = { ...initialCaptureState, status: active('m1') };
  expect(isSessionLive(session('s1', 'm1'), state)).toBe(true);
  expect(isSessionLive(session('s2', 'm2'), state)).toBe(false);
  expect(
    isSessionLive(session('s1', 'm1'), { ...state, status: { active: null, error: null } })
  ).toBe(false);
});

it('a just-started session is live before its meeting id reaches the list', () => {
  const state = {
    ...initialCaptureState,
    status: active('m9'),
    liveSession: { sessionId: 's1', title: 'x' },
  };
  expect(isSessionLive(session('s1', null), state)).toBe(true);
});

it('shows no REC after an interrupted capture that this session had started', () => {
  // The old UI kept REC lit from a never-cleared start acknowledgement.
  useCaptureStore.setState({
    status: { active: null, error: 'capture interrupted' },
    liveSession: { sessionId: 's1', title: 'Weekly' },
  });
  render(<LiveBadge session={session('s1', 'm1')} />);
  expect(screen.queryByText('recording')).toBeNull();
});

it('shows no REC for a persisted recording state without a live capture', () => {
  useCaptureStore.setState({ status: { active: null, error: null } });
  render(<LiveBadge session={{ ...session('s1', 'm1') }} />);
  expect(screen.queryByText('recording')).toBeNull();
});

it('shows REC for the live session and paused while paused', () => {
  useCaptureStore.setState({ status: active('m1') });
  const view = render(<LiveBadge session={session('s1', 'm1')} />);
  expect(screen.getByText('recording')).toBeVisible();
  useCaptureStore.setState({ status: active('m1', true) });
  view.rerender(<LiveBadge session={session('s1', 'm1')} />);
  expect(screen.getByText('paused')).toBeVisible();
});
