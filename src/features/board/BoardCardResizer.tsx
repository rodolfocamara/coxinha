import { useLayoutEffect, useState, type RefObject } from 'react';
import { NodeResizer } from '@xyflow/react';

/** Measure intrinsic content, excluding the user's extra vertical space. */
export function BoardCardResizer({
  body,
  visible,
  text,
}: {
  body: RefObject<HTMLDivElement | null>;
  visible: boolean;
  text: boolean;
}) {
  const floor = text ? 80 : 160;
  const [minimum, setMinimum] = useState(floor);
  useLayoutEffect(() => {
    const root = body.current;
    if (!root || !visible || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const padding = getComputedStyle(root);
        let height =
          6 + (parseFloat(padding.paddingTop) || 0) + (parseFloat(padding.paddingBottom) || 0);
        for (const child of Array.from(root.children) as HTMLElement[]) {
          if (getComputedStyle(child).position === 'absolute') continue;
          if (child.classList.contains('canvas-note')) {
            const style = getComputedStyle(child);
            height += parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            for (const content of Array.from(child.children) as HTMLElement[]) {
              height += content.offsetHeight;
              observer.observe(content);
            }
          } else height += child.offsetHeight;
        }
        const next = Math.max(floor, Math.ceil(height));
        setMinimum((current) => (current === next ? current : next));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [body, visible, floor]);
  return (
    <NodeResizer
      isVisible={visible}
      minWidth={220}
      minHeight={minimum}
      handleClassName="board-resize-handle"
      lineClassName="board-resize-line"
    />
  );
}
