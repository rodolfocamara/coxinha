import { CalendarDays, LayoutDashboard, Mic, Search, Settings, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SessionSidebar } from '../../features/sessions/SessionSidebar';
import { RailItem } from './RailItem';
export interface RailProps {
  onOpenPalette?: () => void;
}
export function Rail({ onOpenPalette }: RailProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <nav
        aria-label={t('a11y.mainNavigation')}
        className="px-3 pt-3 pb-4 flex-1 min-h-0 overflow-y-auto"
      >
        <RailItem
          icon={<Search size={16} aria-hidden="true" />}
          label={t('rail.search')}
          trailing={
            <kbd aria-hidden="true" className="text-[11px] text-muted-foreground font-sans">
              {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}
            </kbd>
          }
          onClick={onOpenPalette ?? (() => window.dispatchEvent(new Event('coxinha:open-palette')))}
        />
        <RailItem
          icon={<LayoutDashboard size={16} aria-hidden="true" />}
          label={t('sessionCalendar.activities')}
          to="/"
        />
        <RailItem
          icon={<CalendarDays size={16} aria-hidden="true" />}
          label={t('sessionCalendar.title')}
          to="/calendar"
        />
        <RailItem
          icon={<Mic size={16} aria-hidden="true" />}
          label={t('rail.recordings')}
          to="/meetings"
        />
        <RailItem
          icon={<Users size={16} aria-hidden="true" />}
          label={t('peopleDirectory.title')}
          to="/people"
        />
        <SessionSidebar />
      </nav>
      <div className="shrink-0 px-3 pt-2 pb-3">
        <RailItem
          icon={<Settings size={16} aria-hidden="true" />}
          label={t('nav.settings')}
          to="/settings"
        />
      </div>
    </div>
  );
}
