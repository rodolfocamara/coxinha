import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingStatus, useRecordingStatusHost } from './RecordingStatus';
import { useDirectCapture } from '../../features/detection/directCapture';
import { sessionListCache } from '../../features/sessions/sessions';
import { sessionCaptureCache } from '../../features/sessions/sessionCapture';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  stop: vi.fn(),
  pause: undefined as ReturnType<typeof vi.fn> | undefined,
  available: vi.fn(() => true),
}));
vi.mock('../../features/meetings/library', () => ({ library: mocks }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: { sessionId?: string };
  }) => (
    <a href={params?.sessionId ? `/sessions/${params.sessionId}` : to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.status.mockReset();
  mocks.stop.mockReset();
  mocks.pause = undefined;
  useDirectCapture.setState({ busy: false, attempt: null, error: null, receipt: null });
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  sessionCaptureCache.setState({ bySession: new Map() });
  useRecordingStatusHost.setState({ activeMounted: false });
});
const active = { active: { meetingId: 'fixture', paused: false, elapsedMs: 4000 }, error: null };
it('shows capture across routes and stops only after an explicit click', async () => {
  vi.useFakeTimers();
  const inactive = { active: null, error: null };
  mocks.status.mockResolvedValue(active);
  mocks.stop.mockImplementation(async () => {
    mocks.status.mockResolvedValue(inactive);
    return inactive;
  });
  await act(async () => {
    render(<RecordingStatus />);
  });
  expect(screen.getByText('desktopRecording.active')).toBeInTheDocument();
  expect(mocks.stop).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
  expect(mocks.stop).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mocks.status.mock.calls.length).toBeGreaterThan(1);
  expect(screen.queryByRole('button')).toBeNull();
});
it('does not overlap polls or schedule another poll after unmount', async () => {
  vi.useFakeTimers();
  let resolve!: (value: typeof active) => void;
  mocks.status.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const view = render(<RecordingStatus />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(mocks.status).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => {
    resolve(active);
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(mocks.status).toHaveBeenCalledOnce();
});
it('retains an actionable library link after a failed stop', async () => {
  mocks.status.mockResolvedValue(active);
  mocks.stop.mockRejectedValue(new Error('device finalize failed'));
  await act(async () => {
    render(<RecordingStatus />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/meetings');
  expect(screen.getByRole('button')).toBeEnabled();
});

it.each([
  ['validation', 'desktopRecording.validating'],
  ['inference', 'desktopRecording.inference'],
  ['stopping', 'desktopRecording.stoppingProcessing'],
  ['future-stage', 'desktopRecording.processing'],
])(
  'shows the reported %s stage without inventing progress or starting capture',
  async (phase, label) => {
    mocks.status.mockResolvedValue({
      active: null,
      processing: { meetingId: 'fixture', job: null, phase },
      error: null,
    });
    await act(async () => {
      render(<RecordingStatus />);
    });
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.getByText('desktopRecording.backgroundProcessing')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.stop).not.toHaveBeenCalled();
  }
);

it('shows capture and processing independently when both are reported', async () => {
  mocks.status.mockResolvedValue({
    ...active,
    processing: { meetingId: 'older', job: 'job', phase: 'inference' },
  });
  await act(async () => {
    render(<RecordingStatus />);
  });
  expect(screen.getByText('desktopRecording.active')).toBeInTheDocument();
  expect(screen.getByText('desktopRecording.inference')).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeEnabled();
  expect(mocks.stop).not.toHaveBeenCalled();
});

it('renders the sidebar recording card with session title, pause/resume and unified receipt dismissal', async () => {
  mocks.status.mockResolvedValue(active);
  mocks.pause = vi.fn().mockResolvedValue({
    active: { ...active.active, paused: true },
    error: null,
  });
  useDirectCapture.setState({
    busy: false,
    attempt: null,
    error: null,
    receipt: { sessionId: 's-live', title: 'Meeting in Google Chrome', metadataFailed: true },
  });
  await act(async () => {
    render(<RecordingStatus variant="sidebar" />);
  });
  expect(useRecordingStatusHost.getState().activeMounted).toBe(true);
  expect(screen.getByRole('link', { name: 'Meeting in Google Chrome' })).toHaveAttribute(
    'href',
    '/sessions/s-live'
  );
  expect(screen.getByRole('alert')).toHaveTextContent('meetingDetection.metadataFailed');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'library.pause' }));
  });
  expect(mocks.pause).toHaveBeenCalledWith(true);
  expect(screen.getByText('desktopRecording.paused')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'meetingDetection.closeNotice' }));
  expect(useDirectCapture.getState().receipt).toBeNull();
});

it('uses shared small buttons and button-styled links in the sidebar card', async () => {
  mocks.status.mockResolvedValue(active);
  useDirectCapture.setState({ busy: false, attempt: null, error: null, receipt: null });
  await act(async () => {
    render(<RecordingStatus variant="sidebar" />);
  });
  const stop = screen.getByRole('button', { name: 'library.stop' });
  expect(stop).toHaveClass('cx-btn');
  expect(stop).toHaveAttribute('data-variant', 'primary');
  expect(stop).toHaveAttribute('data-size', 'sm');
  const open = screen.getByRole('link', { name: 'desktopRecording.open' });
  expect(open).toHaveAttribute('href', '/meetings');
  expect(open).toHaveClass('cx-btn');
  expect(open).toHaveAttribute('data-variant', 'ghost');
  expect(open).not.toHaveClass('underline');
});
