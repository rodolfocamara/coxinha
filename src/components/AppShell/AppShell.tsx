import { MeetingReminder } from '../../features/detection/MeetingReminder';
import { ReactNode, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import brandMark from '../../assets/coxinha-mark.svg';
import { useSidebar } from '../../lib/sidebar';
import { WindowChromeProvider, WindowDragRegion } from './WindowChrome';
import { WindowFrame } from './WindowFrame';
import { SidebarToggle } from './SidebarToggle';
import { RecordingStatus } from './RecordingStatus';
import { ChromeCap } from './ChromeCap';
import { Rail } from './Rail';
import { SidePanel } from './SidePanel';
import type { ChromeTab } from './ChromeTabs';

interface Props {
  /** Override the default rail (dev preview + special pages). */
  rail?: ReactNode;
  /** Right-hand context panel. When omitted, it simply doesn't render. */
  sidePanel?: ReactNode;
  /** Breadcrumb segments displayed in the chrome. */
  trail?: string[];
  /** Open tabs; a single route is presented as a quiet title. */
  tabs?: ChromeTab[];
  /** Right-side slot in the chrome (save status, share, more). */
  chromeRight?: ReactNode;
  /** Left-side slot, inserted between nav buttons and breadcrumb. */
  chromeLeft?: ReactNode;
  children: ReactNode;
}

/**
 * Full-height sidebar beside the content chrome and workspace. See spec 0064.
 */
export function AppShell({
  rail,
  sidePanel,
  trail,
  tabs,
  chromeRight,
  chromeLeft,
  children,
}: Props) {
  const { t } = useTranslation();
  const open = useSidebar((s) => s.open);
  const setOpen = useSidebar((s) => s.setOpen);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const toggleSidebar = () => {
    restoreFocus.current = true;
    setOpen(!open);
  };
  useLayoutEffect(() => {
    if (restoreFocus.current) {
      toggleRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);
  return (
    <WindowChromeProvider>
      <WindowFrame>
        <div className="h-full w-full flex overflow-hidden bg-background text-foreground">
          <a
            href="#canvas"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
          >
            {t('a11y.skipToCanvas')}
          </a>

          {open && (
            <aside
              id="workspace-sidebar"
              aria-label={t('rail.workspace')}
              className="shrink-0 min-h-0 flex flex-col border-r border-border bg-background"
              style={{ width: 'var(--shell-rail-width)' }}
            >
              <div
                className="shrink-0 px-4 flex items-center gap-2"
                style={{ height: 'var(--shell-chrome-height)' }}
              >
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('coxinha:open-map'))}
                  aria-label={t('session.map')}
                  className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-ring"
                >
                  <img src={brandMark} alt="" className="w-7 h-7" />
                  <span className="text-sm font-semibold tracking-tight">{t('brand.name')}</span>
                </button>
                <WindowDragRegion
                  data-testid="brand-drag-region"
                  className="self-stretch flex-1 min-w-2 select-none"
                />
                <div>
                  <SidebarToggle expanded onClick={toggleSidebar} ref={toggleRef} />
                </div>
              </div>
              <RecordingStatus variant="sidebar" />
              {rail ?? <Rail />}
            </aside>
          )}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <ChromeCap
              trail={trail}
              tabs={tabs}
              left={chromeLeft}
              right={chromeRight}
              onToggleRail={open ? undefined : toggleSidebar}
              railToggleRef={toggleRef}
              hasSidePanel={sidePanel != null}
            />

            {!open && <RecordingStatus variant="bar" />}
            <MeetingReminder />
            <div className="flex-1 min-h-0 flex">
              <main id="canvas" className="flex-1 min-w-0 overflow-hidden">
                {children}
              </main>
              {sidePanel && <SidePanel>{sidePanel}</SidePanel>}
            </div>
          </div>
        </div>
      </WindowFrame>
    </WindowChromeProvider>
  );
}
