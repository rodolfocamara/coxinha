import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';

const bridge = vi.hoisted(() => ({
  native: true,
  maximized: false,
  fullscreen: false,
  scale: 1,
  scaleFactor: vi.fn(async (): Promise<number> => bridge.scale),
  resize: undefined as (() => void) | undefined,
  stop: vi.fn(),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  startResizeDragging: vi.fn(async (_direction: string) => {}),
  isMaximized: vi.fn(async (): Promise<boolean> => bridge.maximized),
  isFullscreen: vi.fn(async (): Promise<boolean> => bridge.fullscreen),
  onResized: vi.fn(async (handler: () => void) => {
    bridge.resize = handler;
    return bridge.stop;
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => bridge }));
vi.mock('./RecordingStatus', () => ({ RecordingStatus: () => null }));
import { AppShell } from './AppShell';
import { useSidebar } from '../../lib/sidebar';

beforeEach(() => {
  vi.clearAllMocks();
  bridge.native = true;
  bridge.maximized = false;
  bridge.fullscreen = false;
  bridge.scale = 1;
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Linux WebKitGTK');
  useSidebar.getState().setOpen(true);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

function shell() {
  return render(
    <AppShell rail={<button>Navigation</button>}>
      <button>Board action</button>
      <div data-testid="scrollable" style={{ overflow: 'auto' }}>
        Scrollable workspace
      </div>
    </AppShell>
  );
}
const directions = [
  ['North', 'n-resize'],
  ['NorthEast', 'ne-resize'],
  ['East', 'e-resize'],
  ['SouthEast', 'se-resize'],
  ['South', 's-resize'],
  ['SouthWest', 'sw-resize'],
  ['West', 'w-resize'],
  ['NorthWest', 'nw-resize'],
] as const;

describe('desktop resize perimeter', () => {
  it.each(directions)(
    'dispatches %s with its cursor and consumes only the primary press',
    async (direction, cursor) => {
      const parent = vi.fn();
      render(
        <div onMouseDown={parent}>
          <AppShell rail={<span>Navigation</span>}>Workspace</AppShell>
        </div>
      );
      const edge = await screen.findByTestId(`window-resize-${direction}`);
      expect(edge).toHaveStyle({ cursor });
      expect(fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 })).toBe(
        false
      );
      await waitFor(() =>
        expect(bridge.startResizeDragging).toHaveBeenCalledExactlyOnceWith(direction)
      );
      expect(parent).not.toHaveBeenCalled();
      fireEvent.mouseDown(edge, { button: 2, detail: 1 });
      expect(bridge.startResizeDragging).toHaveBeenCalledOnce();
      expect(bridge.startDragging).not.toHaveBeenCalled();
      expect(bridge.toggleMaximize).not.toHaveBeenCalled();
    }
  );

  it('leaves the native outer five pixels alone to prevent double dispatch', async () => {
    shell();
    const edge = await screen.findByTestId('window-resize-East');
    expect(
      fireEvent.mouseDown(edge, {
        button: 0,
        detail: 1,
        clientX: window.innerWidth - 3,
        clientY: 100,
      })
    ).toBe(true);
    await act(async () => {});
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
    expect(bridge.startDragging).not.toHaveBeenCalled();
  });

  it('leaves the full ten-pixel GTK band to native resizing at scale two', async () => {
    bridge.scale = 2;
    shell();
    const edge = await screen.findByTestId('window-resize-North');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 8 });
    await act(async () => {});
    expect(bridge.scaleFactor).toHaveBeenCalledOnce();
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
    expect(bridge.startDragging).not.toHaveBeenCalled();
    bridge.scale = 1;
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 8 });
    await waitFor(() =>
      expect(bridge.startResizeDragging).toHaveBeenCalledExactlyOnceWith('North')
    );
  });

  it('does not apply GTK scale rules to Windows', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0');
    bridge.scale = 2;
    shell();
    const edge = await screen.findByTestId('window-resize-North');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 8 });
    await waitFor(() =>
      expect(bridge.startResizeDragging).toHaveBeenCalledExactlyOnceWith('North')
    );
    expect(bridge.scaleFactor).not.toHaveBeenCalled();
  });

  it.each([
    ['West', 4.5, 100],
    ['North', 100, 4.5],
  ] as const)(
    'dispatches Windows %s presses outside its native four-pixel border',
    async (direction, clientX, clientY) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0');
      shell();
      const edge = await screen.findByTestId(`window-resize-${direction}`);
      fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX, clientY });
      await waitFor(() =>
        expect(bridge.startResizeDragging).toHaveBeenCalledExactlyOnceWith(direction)
      );
      expect(bridge.startDragging).not.toHaveBeenCalled();
    }
  );

  it('reserves the native gutter before initial state queries finish without a layout jump', async () => {
    let finish!: (value: boolean) => void;
    bridge.isFullscreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    shell();
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    await act(async () => finish(false));
    await screen.findByTestId('window-resize-North');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
  });

  it('does not let North native resize at three pixels start header dragging', async () => {
    shell();
    const edge = await screen.findByTestId('window-resize-North');
    expect(fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 3 })).toBe(
      true
    );
    await act(async () => {});
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
    expect(bridge.startDragging).not.toHaveBeenCalled();
  });

  it('retries a failed native subscription without duplicating active listeners', async () => {
    bridge.onResized.mockRejectedValueOnce(new Error('denied'));
    shell();
    await screen.findByRole('alert');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Retry window controls' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('window-resize-North');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    expect(bridge.onResized).toHaveBeenCalledTimes(2);
    expect(bridge.stop).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('translates resize failure and retry into Portuguese without exposing IPC details', async () => {
    await i18n.changeLanguage('pt-BR');
    bridge.startResizeDragging.mockRejectedValueOnce(new Error('private payload'));
    shell();
    const edge = await screen.findByTestId('window-resize-North');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 8 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A ação da janela falhou. Tente novamente.'
    );
    expect(
      screen.getByRole('button', { name: 'Tentar os controles da janela novamente' })
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('private payload');
  });

  it('prioritizes North resize over header dragging at eight pixels', async () => {
    shell();
    const edge = await screen.findByTestId('window-resize-North');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 400, clientY: 8 });
    await waitFor(() =>
      expect(bridge.startResizeDragging).toHaveBeenCalledExactlyOnceWith('North')
    );
    expect(bridge.startDragging).not.toHaveBeenCalled();
  });

  it('offers an accessible retry when the initial native state query fails', async () => {
    bridge.isFullscreen.mockRejectedValueOnce(new Error('denied'));
    shell();
    await screen.findByRole('alert');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry window controls' }));
    await screen.findByTestId('window-resize-North');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels a pending resize when a newer native state notification arrives', async () => {
    shell();
    const edge = await screen.findByTestId('window-resize-East');
    let finish!: (value: boolean) => void;
    bridge.isFullscreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
    bridge.maximized = true;
    await act(async () => bridge.resize?.());
    await act(async () => finish(false));
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
  });

  it('reserves a gutter and keeps workspace, navigation, scrolling and controls outside hit regions', async () => {
    shell();
    await screen.findByTestId('window-resize-North');
    expect(screen.getByTestId('window-frame')).toHaveAttribute('data-resize-enabled', 'true');
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '10px' });
    for (const target of [
      screen.getByRole('button', { name: 'Board action' }),
      screen.getByRole('button', { name: 'Navigation' }),
      screen.getByRole('button', { name: 'Close window' }),
      screen.getByTestId('scrollable'),
    ]) {
      expect(target.closest('[data-window-resize]')).toBeNull();
      fireEvent.mouseDown(target, { button: 0, detail: 1, clientX: 100, clientY: 100 });
      fireEvent.wheel(target, { deltaY: 100 });
    }
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
    expect(bridge.startDragging).not.toHaveBeenCalled();
    // Corner hit areas extend along the gutter, clipped away from content.
    expect(screen.getByTestId('window-resize-NorthEast').style.clipPath).not.toBe('');
    expect(bridge.onResized).toHaveBeenCalledOnce();
  });

  it('does not add handles or gutter in browser previews', () => {
    bridge.native = false;
    shell();
    expect(screen.queryByTestId('window-resize-North')).toBeNull();
    expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '0px' });
    expect(bridge.onResized).not.toHaveBeenCalled();
  });

  it.each(['maximized', 'fullscreen'] as const)(
    'removes all handles when %s and restores them after native resize',
    async (state) => {
      bridge[state] = true;
      shell();
      await act(async () => {});
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
      expect(screen.getByTestId('window-frame')).toHaveStyle({ padding: '0px' });
      bridge[state] = false;
      await act(async () => bridge.resize?.());
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(8);
      bridge[state] = true;
      await act(async () => bridge.resize?.());
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    }
  );

  it.each(['maximized', 'fullscreen'] as const)(
    'rechecks %s on press before OS notification arrives',
    async (state) => {
      shell();
      const edge = await screen.findByTestId('window-resize-East');
      bridge[state] = true;
      fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
      await act(async () => {});
      expect(bridge.startResizeDragging).not.toHaveBeenCalled();
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    }
  );

  it('reports rejected resize IPC accessibly and permits another press', async () => {
    bridge.startResizeDragging.mockRejectedValueOnce(new Error('private IPC detail'));
    shell();
    const edge = await screen.findByTestId('window-resize-SouthWest');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Window action failed. Try again.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private IPC detail');
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
    await waitFor(() => expect(bridge.startResizeDragging).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fails closed when state cannot be checked, without starting resize', async () => {
    shell();
    const edge = await screen.findByTestId('window-resize-West');
    bridge.isFullscreen.mockRejectedValueOnce(new Error('denied'));
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
    await screen.findByRole('alert');
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
  });

  it('does not dispatch resize after unmount while state queries are pending', async () => {
    const view = shell();
    const edge = await screen.findByTestId('window-resize-West');
    let finish!: (value: boolean) => void;
    bridge.isFullscreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.mouseDown(edge, { button: 0, detail: 1, clientX: 100, clientY: 100 });
    view.unmount();
    await act(async () => finish(false));
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it('keeps minimize, maximize/restore and lifecycle close usable by keyboard', async () => {
    const user = userEvent.setup();
    shell();
    await screen.findByTestId('window-resize-North');
    const minimize = screen.getByRole('button', { name: 'Minimize window' });
    minimize.focus();
    await user.keyboard('{Enter}');
    expect(bridge.minimize).toHaveBeenCalledOnce();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Maximize window' })).toHaveFocus();
    bridge.maximized = true;
    await user.keyboard(' ');
    expect(await screen.findByRole('button', { name: 'Restore window' })).toHaveFocus();
    bridge.maximized = false;
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Maximize window' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close window' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.startResizeDragging).not.toHaveBeenCalled();
  });
});
