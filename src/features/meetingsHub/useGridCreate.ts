import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { dayKey } from '../sessions/sessionDates';
import { DRAG_PX, atMinutes, minutesAt, selection, type Range } from './gridSelect';

type Draft = {
  key: string;
  day: Date;
  pressed: number;
  current: number;
  y: number;
  dragged: boolean;
};

const offset = (event: PointerEvent<HTMLElement>) =>
  event.clientY - event.currentTarget.getBoundingClientRect().top;

/**
 * Click or drag on an empty slot of a day column (spec 0104 P5). Presses on a
 * meeting block are left to the block, which opens the meeting.
 */
export function useGridCreate(onCreate?: (start: Date, end: Date) => void) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // Handlers read the ref: a move can arrive before the press re-renders.
  const live = useRef<Draft | null>(null);
  const put = (next: Draft | null) => {
    live.current = next;
    setDraft(next);
  };
  const active = draft !== null;

  useEffect(() => {
    if (!active) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      live.current = null;
      setDraft(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [active]);

  const columnProps = (day: Date) => {
    if (!onCreate) return {};
    const key = dayKey(day);
    const mine = () => (live.current?.key === key ? live.current : null);
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return;
        try {
          // Keeps the drag when the pointer leaves the column; a pointer the
          // browser no longer tracks throws, and the drag still works without it.
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          /* capture is optional */
        }
        const at = minutesAt(offset(event));
        put({ key, day, pressed: at, current: at, y: event.clientY, dragged: false });
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = mine();
        if (!current) return;
        const dragged = current.dragged || Math.abs(event.clientY - current.y) >= DRAG_PX;
        put({ ...current, current: minutesAt(offset(event)), dragged });
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const current = mine();
        if (!current) return;
        put(null);
        const dragged = current.dragged || Math.abs(event.clientY - current.y) >= DRAG_PX;
        const range = selection(current.pressed, minutesAt(offset(event)), dragged);
        onCreate(atMinutes(current.day, range.from), atMinutes(current.day, range.to));
      },
      onPointerCancel: () => put(null),
    };
  };

  /** The range to preview in this column while dragging. */
  const preview = (day: Date): Range | null =>
    draft?.dragged && draft.key === dayKey(day)
      ? selection(draft.pressed, draft.current, true)
      : null;

  return { columnProps, preview, selecting: active };
}
