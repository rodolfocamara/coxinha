import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../components/ui';
import { useActiveScopes, useEscapeLayer, useShortcut, useShortcutScope } from './useShortcut';

afterEach(cleanup);

const field = () => {
  const input = document.createElement('input');
  document.body.append(input);
  return input;
};

describe('useShortcut', () => {
  it('fires for each chord of the table and prevents the browser default', () => {
    const run = vi.fn();
    renderHook(() => useShortcut('app.palette', run));
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true })).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps plain keys out of every kind of text field', () => {
    const run = vi.fn();
    renderHook(() => useShortcut('board.newNote', run));
    const input = field();
    fireEvent.keyDown(input, { key: '1' });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: '1' });
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    document.body.append(textbox);
    fireEvent.keyDown(textbox, { key: '1' });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '1' });
    expect(run).toHaveBeenCalledOnce();
    [input, editable, textbox].forEach((node) => node.remove());
  });

  it('lets a chord into a field only when the table says so', () => {
    const inFields = vi.fn();
    const notInFields = vi.fn();
    renderHook(() => {
      useShortcut('note.copyLink', inFields);
      useShortcut('board.undo', notInFields);
    });
    const input = field();
    fireEvent.keyDown(input, { key: 'l', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(inFields).toHaveBeenCalledOnce();
    expect(notInFields).not.toHaveBeenCalled();
    input.remove();
  });

  it('yields to a key someone already handled, and to composition', () => {
    const run = vi.fn();
    renderHook(() => useShortcut('board.newNote', run));
    const handled = new KeyboardEvent('keydown', { key: '1', cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', isComposing: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it('does not repeat unless the table says so', () => {
    const once = vi.fn();
    const held = vi.fn();
    renderHook(() => {
      useShortcut('board.newNote', once);
      useShortcut('calendar.next', held);
    });
    fireEvent.keyDown(window, { key: '1', repeat: true });
    fireEvent.keyDown(window, { key: 'j', repeat: true });
    expect(once).not.toHaveBeenCalled();
    expect(held).toHaveBeenCalledOnce();
  });

  it('gives a key two scopes claim to the most specific one', () => {
    const board = vi.fn();
    const app = vi.fn();
    renderHook(() => {
      useShortcut('app.undoTrash', app);
      useShortcut('board.undo', board);
    });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(board).toHaveBeenCalledOnce();
    expect(app).not.toHaveBeenCalled();
  });

  it('passes a key over a disabled handler to the next scope', () => {
    const board = vi.fn();
    const app = vi.fn();
    renderHook(() => {
      useShortcut('app.undoTrash', app);
      useShortcut('board.undo', board, { enabled: false });
    });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(app).toHaveBeenCalledOnce();
    expect(board).not.toHaveBeenCalled();
  });

  it('leaves a declined key to the browser', () => {
    renderHook(() => useShortcut('palette.delete', () => false));
    expect(fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true })).toBe(true);
  });

  it('runs the handler of the last render, and stops at unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(({ run }) => useShortcut('board.newNote', run), {
      initialProps: { run: first },
    });
    view.rerender({ run: second });
    fireEvent.keyDown(window, { key: '1' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    view.unmount();
    fireEvent.keyDown(window, { key: '1' });
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('a dialog blocks what is underneath', () => {
  it('stops other scopes while a modal layer is open', () => {
    const board = vi.fn();
    const palette = vi.fn();
    const toggle = vi.fn();
    const view = renderHook(
      ({ open }) => {
        useShortcut('board.newNote', board);
        useShortcut('palette.delete', palette);
        useShortcut('app.palette', toggle);
        useEscapeLayer(open, () => undefined, { modal: true, scope: 'palette' });
      },
      { initialProps: { open: true } }
    );
    fireEvent.keyDown(window, { key: '1' });
    expect(board).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true });
    expect(palette).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(toggle).toHaveBeenCalledOnce();
    view.rerender({ open: false });
    fireEvent.keyDown(window, { key: '1' });
    expect(board).toHaveBeenCalledOnce();
  });

  it('a non-modal layer such as a peek blocks nothing', () => {
    const run = vi.fn();
    renderHook(() => {
      useShortcut('calendar.today', run);
      useEscapeLayer(true, () => undefined);
    });
    fireEvent.keyDown(window, { key: 't' });
    expect(run).toHaveBeenCalledOnce();
  });
});

function Layers({ closed }: { closed: (name: string) => void }) {
  const [open, setOpen] = useState({ a: true, b: true, c: true });
  const close = (name: 'a' | 'b' | 'c') => {
    closed(name);
    setOpen((was) => ({ ...was, [name]: false }));
  };
  useEscapeLayer(open.a, () => close('a'));
  useEscapeLayer(open.b, () => close('b'));
  useEscapeLayer(open.c, () => close('c'));
  return null;
}

describe('Esc closes one layer at a time', () => {
  it('closes the top layer on each press, newest first', () => {
    const closed = vi.fn();
    render(<Layers closed={closed} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed.mock.calls).toEqual([['c']]);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed.mock.calls).toEqual([['c'], ['b'], ['a']]);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
  });

  it('a layer opened later goes on top, whatever was mounted first', () => {
    const closed = vi.fn();
    const view = renderHook(
      ({ early }) => {
        useEscapeLayer(early, () => closed('early'));
        useEscapeLayer(true, () => closed('late'));
      },
      { initialProps: { early: false } }
    );
    view.rerender({ early: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed.mock.calls).toEqual([['early']]);
  });

  it('a handled Esc, such as a field clearing itself, closes nothing', () => {
    const closed = vi.fn();
    renderHook(() => useEscapeLayer(true, closed));
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(closed).not.toHaveBeenCalled();
  });

  it('a layer can leave Esc to a text field', () => {
    const closed = vi.fn();
    renderHook(() => useEscapeLayer(true, closed, { fromFields: false }));
    const input = field();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(closed).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toHaveBeenCalledOnce();
    input.remove();
  });

  it('survives a close handler changing between renders without moving down the stack', () => {
    const closed = vi.fn();
    const view = renderHook(
      ({ tag }) => {
        useEscapeLayer(true, () => closed(`bottom ${tag}`));
      },
      { initialProps: { tag: 1 } }
    );
    renderHook(() => useEscapeLayer(true, () => closed('top')));
    view.rerender({ tag: 2 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed.mock.calls).toEqual([['top']]);
  });

  it('a layer over a Radix sheet closes before the sheet', async () => {
    const closedLayer = vi.fn();
    const closedSheet = vi.fn();
    function Both() {
      const [layer, setLayer] = useState(false);
      useEscapeLayer(layer, () => {
        closedLayer();
        setLayer(false);
      });
      return (
        <Sheet open onOpenChange={closedSheet} title="Sheet" closeLabel="Close">
          <button type="button" onClick={() => setLayer(true)}>
            open layer
          </button>
        </Sheet>
      );
    }
    render(<Both />);
    fireEvent.click(await screen.findByRole('button', { name: 'open layer' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closedLayer).toHaveBeenCalledOnce();
    expect(closedSheet).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closedSheet).toHaveBeenCalledWith(false);
  });

  it('a sheet blocks the shortcuts underneath it', async () => {
    const run = vi.fn();
    function WithSheet() {
      useShortcut('board.newNote', run);
      return (
        <Sheet open onOpenChange={() => undefined} title="Sheet" closeLabel="Close">
          body
        </Sheet>
      );
    }
    render(<WithSheet />);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: '1' });
    expect(run).not.toHaveBeenCalled();
  });
});

it('reports the scopes on screen, and drops them when they leave', () => {
  const scopes = renderHook(() => useActiveScopes());
  const view = renderHook(() => useShortcutScope('board'));
  expect(scopes.result.current).toContain('board');
  act(() => view.unmount());
  expect(scopes.result.current).not.toContain('board');
});
