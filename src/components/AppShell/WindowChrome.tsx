import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowChrome } from './useWindowChrome';

type ChromeState = ReturnType<typeof useWindowChrome>;
export const ChromeContext = createContext<ChromeState | null>(null);

/** One native subscription shared by both explicit blank drag regions. */
export function WindowChromeProvider({ children }: { children: ReactNode }) {
  const state = useWindowChrome();
  return <ChromeContext.Provider value={state}>{children}</ChromeContext.Provider>;
}

export function WindowDragRegion(props: ComponentProps<'div'>) {
  const state = useContext(ChromeContext);
  return (
    <div
      {...props}
      onMouseDown={
        state?.native
          ? (event) => {
              if (event.button !== 0 || event.target !== event.currentTarget) return;
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              // Native dragging may consume mouseup. Use Tauri's mousedown click count.
              if (event.detail === 1) void state.run('startDragging');
              else if (event.detail === 2) void state.run('toggleMaximize');
            }
          : undefined
      }
    />
  );
}

/** Standalone callers get a provider; AppShell shares its existing provider. */
export function WindowChrome({ children }: { children?: ReactNode }) {
  const state = useContext(ChromeContext);
  const { t } = useTranslation();
  if (!state)
    return (
      <WindowChromeProvider>
        <WindowChrome>{children}</WindowChrome>
      </WindowChromeProvider>
    );
  const { native, maximized, failed, run, retry } = state;
  return (
    <>
      <WindowDragRegion
        data-testid="window-drag-region"
        className="self-stretch flex-1 min-w-4 select-none"
      />
      {children}
      {native && (
        <div className="flex items-center self-stretch shrink-0 -mr-3 ml-1">
          {failed && (
            <span role="alert" className="text-xs text-destructive px-2 max-w-48">
              {t('windowChrome.failed')}
              <button
                type="button"
                onClick={() => void retry()}
                className="ml-1 underline focus-visible:outline focus-visible:outline-ring"
              >
                {t('windowChrome.retry')}
              </button>
            </span>
          )}
          {(
            [
              ['minimize', Minus, 'minimize'],
              ['toggleMaximize', maximized ? Copy : Square, maximized ? 'restore' : 'maximize'],
              ['close', X, 'close'],
            ] as const
          ).map(([action, Icon, label]) => (
            <button
              key={action}
              type="button"
              aria-label={t(`windowChrome.${label}`)}
              title={t(`windowChrome.${label}`)}
              onClick={() => void run(action)}
              className={`h-full w-10 flex items-center justify-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${action === 'close' ? 'hover:bg-destructive hover:text-white' : 'hover:bg-secondary hover:text-foreground'}`}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
