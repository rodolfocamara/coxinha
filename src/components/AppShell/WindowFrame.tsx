import {
  useContext,
  useLayoutEffect,
  type ContextType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ChromeContext } from './WindowChrome';

type Direction = Parameters<NonNullable<ContextType<typeof ChromeContext>>['resize']>[0];
const gutter = 10;
const nativeInset = 5;
const corner = 24;
const viewportOwners = new Map<symbol, boolean>();

function syncViewportClip() {
  const rounded = [...viewportOwners.values()].at(-1) ?? false;
  if (rounded) document.documentElement.dataset.windowRounded = 'true';
  else delete document.documentElement.dataset.windowRounded;
}
// L-shaped corners stay entirely in the gutter, leaving content and scrollbars untouched.
const regions: { direction: Direction; style: CSSProperties }[] = [
  {
    direction: 'North',
    style: { top: 0, left: corner, right: corner, height: gutter, cursor: 'n-resize' },
  },
  {
    direction: 'East',
    style: { right: 0, top: corner, bottom: corner, width: gutter, cursor: 'e-resize' },
  },
  {
    direction: 'South',
    style: { bottom: 0, left: corner, right: corner, height: gutter, cursor: 's-resize' },
  },
  {
    direction: 'West',
    style: { left: 0, top: corner, bottom: corner, width: gutter, cursor: 'w-resize' },
  },
  {
    direction: 'NorthWest',
    style: {
      top: 0,
      left: 0,
      width: corner,
      height: corner,
      cursor: 'nw-resize',
      clipPath: 'polygon(0 0, 100% 0, 100% 10px, 10px 10px, 10px 100%, 0 100%)',
    },
  },
  {
    direction: 'NorthEast',
    style: {
      top: 0,
      right: 0,
      width: corner,
      height: corner,
      cursor: 'ne-resize',
      clipPath: 'polygon(0 0, 100% 0, 100% 100%, 14px 100%, 14px 10px, 0 10px)',
    },
  },
  {
    direction: 'SouthEast',
    style: {
      bottom: 0,
      right: 0,
      width: corner,
      height: corner,
      cursor: 'se-resize',
      clipPath: 'polygon(14px 0, 100% 0, 100% 100%, 0 100%, 0 14px, 14px 14px)',
    },
  },
  {
    direction: 'SouthWest',
    style: {
      bottom: 0,
      left: 0,
      width: corner,
      height: corner,
      cursor: 'sw-resize',
      clipPath: 'polygon(0 0, 10px 0, 10px 14px, 100% 14px, 100% 100%, 0 100%)',
    },
  },
];

/** Native perimeter only. The content is inset instead of being covered by hit targets. */
export function WindowFrame({ children }: { children: ReactNode }) {
  const state = useContext(ChromeContext);
  const enabled = state?.resizable ?? false;
  // Keep content away from the native perimeter while queries/listeners load or fail.
  const hasGutter = state?.native && !state.maximized && !state.fullscreen;
  // Linux compositors (KWin, Mutter) let users grab just outside a window's edge.
  // Keep the gutter transparent there so the hit regions sit outside the visible
  // surface. Win32 keeps the opaque gutter it already resizes natively.
  const outside = Boolean(hasGutter) && navigator.userAgent.includes('Linux');
  useLayoutEffect(() => {
    // Fixed overlays and body portals escape frame overflow. Share its state
    // with the viewport clip before paint, without changing fixed positioning.
    const owner = Symbol();
    viewportOwners.set(owner, Boolean(hasGutter));
    syncViewportClip();
    return () => {
      viewportOwners.delete(owner);
      syncViewportClip();
    };
  }, [hasGutter]);
  return (
    <div
      data-testid="window-frame"
      data-resize-enabled={enabled}
      data-resize-outside={outside}
      className={`relative h-screen w-screen overflow-hidden ${outside ? 'bg-transparent' : 'bg-background'}`}
      style={{
        padding: hasGutter ? gutter : 0,
        boxSizing: 'border-box',
        // 10px keeps the native (3, 3) diagonal inside the curve.
        borderRadius: hasGutter && !outside ? 'var(--radius-md)' : 0,
      }}
    >
      {/* Always mounted: toggling a wrapper on maximize would remount the workspace. */}
      <div
        data-testid="window-surface"
        className={`h-full w-full ${outside ? 'overflow-hidden bg-background' : ''}`}
        style={
          outside
            ? {
                borderRadius: 'var(--radius-md)',
                // Fits the 10px gutter: a hairline edge plus a short drop shadow.
                boxShadow: '0 0 0 1px var(--color-border), 0 2px 8px rgb(0 0 0 / 0.28)',
              }
            : undefined
        }
      >
        {children}
      </div>
      {enabled &&
        regions.map(({ direction, style }) => (
          <div
            key={direction}
            data-window-resize={direction}
            data-testid={`window-resize-${direction}`}
            aria-hidden="true"
            className="absolute select-none"
            style={style}
            onMouseDown={(event) => {
              if (event.button !== 0 || event.target !== event.currentTarget) return;
              // GTK forwards native border presses to the DOM; avoid a second gesture.
              // Win32 consumes its native hits first, so every DOM press needs JS resize.
              const { clientX: x, clientY: y } = event;
              if (
                navigator.userAgent.includes('Linux') &&
                (x < nativeInset ||
                  y < nativeInset ||
                  x >= window.innerWidth - nativeInset ||
                  y >= window.innerHeight - nativeInset)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              void state?.resize(direction, { x, y });
            }}
          />
        ))}
    </div>
  );
}
