import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoardViewport } from './useBoardViewport';
import type { BoardItem } from './model';
let viewport: ReturnType<typeof useBoardViewport>;
let bounds = { width: 1004, height: 580 };
const observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
const setViewport = vi.fn(
  async (_viewport: { x: number; y: number; zoom: number }, _options?: { duration?: number }) =>
    true
);
const item: BoardItem = {
  id: 'new-card',
  kind: 'card',
  x: 80,
  y: 100,
  width: 230,
  height: 110,
  color: 'neutral',
  label: '',
  noteId: 'note',
  notePath: 'notes/note.md',
};
function Harness({ ready = true, panelId = null }: { ready?: boolean; panelId?: string | null }) {
  viewport = useBoardViewport(ready, panelId);
  return <div ref={viewport.canvas} />;
}
beforeEach(() => {
  setViewport.mockClear();
  bounds = { width: 1004, height: 580 };
  observers.length = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => bounds as DOMRect
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      constructor(notify: () => void) {
        observers.push({ notify, disconnect: this.disconnect });
      }
      observe() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('centers using the final rendered canvas after side-by-side and stacked editor composition', () => {
  const view = render(<Harness />);
  act(() => {
    viewport.initialize({
      setViewport,
      screenToFlowPosition: (point: { x: number; y: number }) => point,
    });
    viewport.focus(item);
  });
  expect(setViewport).toHaveBeenLastCalledWith({ x: 307, y: 135, zoom: 1 }, { duration: 0 });
  // The editor consumes width in the wide layout. ReactFlow internals need not resize first.
  bounds = { width: 544, height: 580 };
  view.rerender(<Harness panelId="note" />);
  expect(setViewport).toHaveBeenLastCalledWith({ x: 77, y: 135, zoom: 1 }, { duration: 0 });
  // In a narrow board the editor stacks below, changing both canvas dimensions.
  bounds = { width: 524, height: 220 };
  act(() => observers.at(-1)!.notify());
  expect(setViewport).toHaveBeenLastCalledWith({ x: 67, y: -45, zoom: 1 }, { duration: 0 });
  const transform = setViewport.mock.calls.at(-1)![0] as unknown as {
    x: number;
    y: number;
    zoom: number;
  };
  expect(item.x * transform.zoom + transform.x).toBeGreaterThanOrEqual(24);
  expect((item.x + item.width) * transform.zoom + transform.x).toBeLessThanOrEqual(
    bounds.width - 24
  );
  expect(item.y * transform.zoom + transform.y).toBeGreaterThanOrEqual(24);
  expect((item.y + item.height) * transform.zoom + transform.y).toBeLessThanOrEqual(
    bounds.height - 24
  );
});
it('attaches after board loading and disconnects when unmounted', () => {
  const view = render(<Harness ready={false} />);
  act(() => {
    viewport.initialize({
      setViewport,
      screenToFlowPosition: (point: { x: number; y: number }) => point,
    });
    viewport.focus(item);
  });
  expect(setViewport).not.toHaveBeenCalled();
  view.rerender(<Harness ready />);
  expect(setViewport).toHaveBeenCalled();
  const observer = observers.at(-1)!;
  view.unmount();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});
it('fits an item in a short canvas and yields subsequent resizes to user panning or item movement', () => {
  bounds = { width: 400, height: 130 };
  render(<Harness />);
  act(() => {
    viewport.initialize({
      setViewport,
      screenToFlowPosition: (point: { x: number; y: number }) => point,
    });
    viewport.focus(item);
  });
  expect(setViewport.mock.calls.at(-1)![0]).toMatchObject({ zoom: (130 - 48) / item.height });
  const calls = setViewport.mock.calls.length;
  act(() => {
    viewport.release();
    observers.at(-1)!.notify();
  });
  expect(setViewport).toHaveBeenCalledTimes(calls);
});
