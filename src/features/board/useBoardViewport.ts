import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { BoardItem } from './model';

type Viewport = Pick<ReactFlowInstance, 'setViewport' | 'screenToFlowPosition'>;
/** Center explicit item opens using rendered canvas bounds, including panel composition. */
export function useBoardViewport(ready: boolean, panelId: string | null) {
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useRef<Viewport | null>(null);
  const target = useRef<BoardItem | null>(null);
  const [request, setRequest] = useState(0);
  const center = useCallback(() => {
    const bounds = canvas.current?.getBoundingClientRect();
    const item = target.current;
    if (!bounds?.width || !bounds.height || !item || !flow.current) return;
    const zoom = Math.min(
      1,
      Math.max(0.1, (bounds.width - 48) / item.width),
      Math.max(0.1, (bounds.height - 48) / item.height)
    );
    // setCenter reads ReactFlow's asynchronously updated dimensions. setViewport
    // uses the actual rendered bounds directly, without waiting for its observer.
    void flow.current.setViewport(
      {
        x: bounds.width / 2 - (item.x + item.width / 2) * zoom,
        y: bounds.height / 2 - (item.y + item.height / 2) * zoom,
        zoom,
      },
      { duration: 0 }
    );
  }, []);
  useLayoutEffect(() => {
    if (!ready || !canvas.current) return;
    center();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(center);
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [ready, panelId, request, center]);
  return {
    canvas,
    screenPosition(point: { x: number; y: number }) {
      return flow.current?.screenToFlowPosition(point);
    },
    creationPosition(width: number, height: number) {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds || !flow.current?.screenToFlowPosition) return { x: 80, y: 100 };
      const center = flow.current.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
      return { x: center.x - width / 2, y: center.y - height / 2 };
    },
    initialize(instance: Viewport) {
      flow.current = instance;
      center();
    },
    release() {
      target.current = null;
    },
    focus(item: BoardItem) {
      target.current = item;
      setRequest((previous) => previous + 1);
    },
  };
}
