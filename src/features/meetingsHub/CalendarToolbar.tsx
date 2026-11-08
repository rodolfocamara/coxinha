import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Globe2, Plus, Search, Upload } from 'lucide-react';
import { Button } from '../../components/ui';
import { shortcutAria, shortcutHint } from '../../lib/shortcuts';
import { openSearch } from '../../components/AppShell/SearchBar';
import type { CalendarView } from './calendarViews';
import { ViewSwitcher } from './ViewSwitcher';
import { settingsLocation } from '../settings/settingsIndex';

type Props = {
  view: CalendarView;
  days: number;
  onView: (view: CalendarView, days: number) => void;
  label: string;
  previousLabel: string;
  nextLabel: string;
  onToday: () => void;
  onStep: (direction: 1 | -1) => void;
  onNew: () => void;
  onImport: () => void;
  desktop: boolean;
};

/** Outlook's calendar bar (spec 0107); its search opens the universal one (spec 0122). */
export function CalendarToolbar(p: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  return (
    <header className="ch-bar">
      <h1 className="sr-only">{t('meetingsHub.title')}</h1>
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus size={14} aria-hidden="true" />}
        disabled={!p.desktop}
        aria-keyshortcuts={shortcutAria('calendar.new')}
        title={`${k('newMeeting')} · ${shortcutHint('calendar.new')}`}
        onClick={p.onNew}
      >
        {k('newMeeting')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Upload size={15} aria-hidden="true" />}
        aria-label={t('meetingsHub.importAudio')}
        title={t('meetingsHub.importAudio')}
        disabled={!p.desktop}
        onClick={p.onImport}
      />
      <span className="ch-sep" aria-hidden="true" />
      <Button
        size="sm"
        aria-keyshortcuts={shortcutAria('calendar.today')}
        title={`${t('meetingsHub.calendar.today')} · ${shortcutHint('calendar.today')}`}
        onClick={p.onToday}
      >
        {t('meetingsHub.calendar.today')}
      </Button>
      <Button
        size="sm"
        iconOnly
        icon={<ChevronLeft size={15} aria-hidden="true" />}
        aria-label={p.previousLabel}
        aria-keyshortcuts={shortcutAria('calendar.previous')}
        title={`${p.previousLabel} · ${shortcutHint('calendar.previous')}`}
        onClick={() => p.onStep(-1)}
      />
      <Button
        size="sm"
        iconOnly
        icon={<ChevronRight size={15} aria-hidden="true" />}
        aria-label={p.nextLabel}
        aria-keyshortcuts={shortcutAria('calendar.next')}
        title={`${p.nextLabel} · ${shortcutHint('calendar.next')}`}
        onClick={() => p.onStep(1)}
      />
      <h2 className="ch-title" aria-live="polite">
        {p.label}
      </h2>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={<Search size={15} aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-label={t('search.bar')}
        title={t('search.bar')}
        onClick={openSearch}
      />
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={<Globe2 size={15} aria-hidden="true" />}
        aria-label={k('timeZones')}
        title={k('timeZones')}
        onClick={() => void navigate(settingsLocation('time-zones'))}
      />
      <ViewSwitcher view={p.view} days={p.days} onChange={p.onView} />
    </header>
  );
}
