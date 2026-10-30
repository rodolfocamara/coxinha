import { ReactNode } from 'react';
import { PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSidePanel } from '../../lib/panels';
import { SidebarToggle } from './SidebarToggle';
import brandMark from '../../assets/coxinha-mark.svg';
import { WindowChrome } from './WindowChrome';
import { Breadcrumb } from './Breadcrumb';
import { ChromeTabs, type ChromeTab } from './ChromeTabs';

export interface ChromeCapProps {
  trail?: string[];
  tabs?: ChromeTab[];
  left?: ReactNode;
  right?: ReactNode;
  onToggleRail?: () => void;
  railToggleRef?: React.Ref<HTMLButtonElement>;
  hasSidePanel?: boolean;
}

export function ChromeCap({
  trail,
  tabs,
  left,
  right,
  onToggleRail,
  railToggleRef,
  hasSidePanel,
}: ChromeCapProps) {
  const { t } = useTranslation();
  const toggleSidePanel = useSidePanel((s) => s.toggle);
  const sidePanelOpen = useSidePanel((s) => s.open);

  const multipleTabs = tabs && tabs.length > 1;
  const pageTrail = trail?.length ? trail : tabs?.length === 1 ? [tabs[0].label] : [];

  return (
    <header
      className="shrink-0 flex items-center gap-2 px-3 min-w-0 border-b border-border bg-background"
      style={{ height: 'var(--shell-chrome-height)' }}
    >
      {onToggleRail && (
        <div className="flex items-center gap-1 shrink-0">
          <SidebarToggle expanded={false} onClick={onToggleRail} ref={railToggleRef} />
          <button
            type="button"
            aria-label={t('session.map')}
            onClick={() => window.dispatchEvent(new Event('coxinha:open-map'))}
            className="rounded focus-visible:outline focus-visible:outline-ring"
          >
            <img src={brandMark} alt={t('brand.name')} className="w-6 h-6" />
          </button>
        </div>
      )}

      {multipleTabs && <ChromeTabs tabs={tabs} />}

      <div className="min-w-0 flex items-center">{left}</div>

      {!multipleTabs && pageTrail.length > 0 && <Breadcrumb trail={pageTrail} />}

      <WindowChrome>
        <div className="flex items-center gap-2 min-w-0">
          {right}
          {hasSidePanel && (
            <IconButton
              icon={<PanelRight size={16} aria-hidden="true" />}
              label={t('sidePanel.toggle')}
              onClick={toggleSidePanel}
              active={sidePanelOpen}
            />
          )}
        </div>
      </WindowChrome>
    </header>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={
        'w-7 h-7 rounded-md flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        (active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60')
      }
    >
      {icon}
    </button>
  );
}
