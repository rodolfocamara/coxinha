import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../lib/i18n';

const bridge = vi.hoisted(() => ({
  native: true,
  maximized: false,
  resize: undefined as (() => void) | undefined,
  stop: vi.fn(),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  isFullscreen: vi.fn(async () => false),
  isMaximized: vi.fn(async (): Promise<boolean> => bridge.maximized),
  onResized: vi.fn(async (handler: () => void) => {
    bridge.resize = handler;
    return bridge.stop;
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => bridge }));
import { WindowChrome } from './WindowChrome';
import { ShellFrame } from '../Shell/Shell';
import { useWindowChrome } from './useWindowChrome';
import { renderHook } from '@testing-library/react';

beforeEach(() => {
  vi.clearAllMocks();
  bridge.native = true;
  bridge.maximized = false;
});
afterEach(cleanup);

describe('integrated window chrome', () => {
  it('omits native controls and IPC in browser previews', () => {
    bridge.native = false;
    render(
      <WindowChrome>
        <button>App action</button>
      </WindowChrome>
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.mouseDown(screen.getByTestId('window-drag-region'), { button: 0, detail: 1 });
    expect(bridge.startDragging).not.toHaveBeenCalled();
    expect(bridge.onResized).not.toHaveBeenCalled();
  });

  it('uses native minimize, maximize/restore and lifecycle-aware close', async () => {
    render(<WindowChrome />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    bridge.maximized = true;
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }));
    await screen.findByRole('button', { name: 'Restore window' });
    expect(bridge.minimize).toHaveBeenCalledOnce();
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.toggleMaximize).toHaveBeenCalledOnce();
    bridge.maximized = false;
    act(() => bridge.resize?.());
    await screen.findByRole('button', { name: 'Maximize window' });
  });

  it('drags only blank primary presses and maximizes on double-click', async () => {
    render(
      <WindowChrome>
        <a href="#target">Link</a>
        <input aria-label="Title" />
      </WindowChrome>
    );
    const region = screen.getByTestId('window-drag-region');
    fireEvent.mouseDown(region, { button: 0, detail: 1 });
    fireEvent.mouseDown(region, { button: 2, detail: 1 });
    fireEvent.mouseDown(region, { button: 0, detail: 2 });
    fireEvent.mouseDown(screen.getByRole('link'), { button: 0, detail: 1 });
    fireEvent.mouseDown(screen.getByRole('textbox'), { button: 0, detail: 1 });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Close window' }), {
      button: 0,
      detail: 1,
    });
    // No mouseup/dblclick is needed after native drag consumes the first press.
    fireEvent.doubleClick(region, { button: 0 });
    await waitFor(() => expect(bridge.toggleMaximize).toHaveBeenCalledOnce());
    expect(bridge.startDragging).toHaveBeenCalledOnce();
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it('shows failures without rejecting the event and allows retry', async () => {
    bridge.minimize.mockRejectedValueOnce(new Error('denied'));
    render(<WindowChrome />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Window action failed');
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(bridge.minimize).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes after unmount including delayed native listener registration', async () => {
    let registered!: (stop: typeof bridge.stop) => void;
    bridge.onResized.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          registered = resolve;
        })
    );
    const view = render(<WindowChrome />);
    view.unmount();
    await act(async () => registered(bridge.stop));
    expect(bridge.stop).toHaveBeenCalledOnce();
    const next = render(<WindowChrome />);
    await act(async () => {});
    next.unmount();
    expect(bridge.stop).toHaveBeenCalledTimes(2);
  });

  it('handles resize subscription failure', async () => {
    bridge.onResized.mockRejectedValueOnce(new Error('unavailable'));
    render(<WindowChrome />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Window action failed');
  });
  it('ignores stale initial and action queries after newer resize results', async () => {
    let initial!: (value: boolean) => void;
    let action!: (value: boolean) => void;
    bridge.isMaximized.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          initial = resolve;
        })
    );
    const { result } = renderHook(useWindowChrome);
    bridge.maximized = true;
    await act(async () => bridge.resize?.());
    expect(result.current.maximized).toBe(true);
    await act(async () => initial(false));
    expect(result.current.maximized).toBe(true);

    bridge.isMaximized.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          action = resolve;
        })
    );
    let running!: Promise<void>;
    await act(async () => {
      running = result.current.run('toggleMaximize');
    });
    bridge.maximized = false;
    await act(async () => bridge.resize?.());
    expect(result.current.maximized).toBe(false);
    await act(async () => {
      action(true);
      await running;
    });
    expect(result.current.maximized).toBe(false);
  });

  it('does not refresh or report an action result after unmount', async () => {
    let finish!: () => void;
    bridge.toggleMaximize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result, unmount } = renderHook(useWindowChrome);
    await act(async () => {});
    const reads = bridge.isMaximized.mock.calls.length;
    let running!: Promise<void>;
    act(() => {
      running = result.current.run('toggleMaximize');
    });
    unmount();
    await act(async () => {
      finish();
      await running;
    });
    expect(bridge.isMaximized).toHaveBeenCalledTimes(reads);
  });
});

it('drags from the recorder strip blank area, isolates controls and reports drag failures', async () => {
  const parentMouseDown = vi.fn();
  const view = render(
    <div onMouseDown={parentMouseDown}>
      <ShellFrame
        strip={
          <header>
            <span>Coxinha</span>
            <WindowChrome>
              <button>Pause</button>
            </WindowChrome>
          </header>
        }
        nav={<button>Navigation</button>}
      >
        <p>Workspace</p>
      </ShellFrame>
    </div>
  );
  await waitFor(() => expect(bridge.onResized).toHaveBeenCalledOnce());
  const region = screen.getByTestId('window-drag-region');
  expect(fireEvent.mouseDown(region, { button: 0, detail: 1 })).toBe(false);
  expect(parentMouseDown).not.toHaveBeenCalled();
  expect(bridge.startDragging).toHaveBeenCalledOnce();
  fireEvent.mouseDown(region, { button: 0, detail: 2 });
  fireEvent.mouseDown(region, { button: 2, detail: 1 });
  const nestedContent = document.createElement('span');
  region.appendChild(nestedContent);
  fireEvent.mouseDown(nestedContent, { button: 0, detail: 1 });
  nestedContent.remove();
  fireEvent.mouseDown(screen.getByText('Coxinha'), { button: 0, detail: 1 });
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Navigation' }), { button: 0, detail: 1 });
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Pause' }), { button: 0, detail: 1 });
  expect(bridge.startDragging).toHaveBeenCalledOnce();
  expect(bridge.toggleMaximize).toHaveBeenCalledOnce();
  bridge.startDragging.mockRejectedValueOnce(new Error('compositor unavailable'));
  fireEvent.mouseDown(region, { button: 0, detail: 1 });
  expect(await screen.findByRole('alert')).toHaveTextContent('Window action failed');
  fireEvent.mouseDown(region, { button: 0, detail: 1 });
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(bridge.onResized).toHaveBeenCalledOnce();
  view.unmount();
  expect(bridge.stop).toHaveBeenCalledOnce();
});
