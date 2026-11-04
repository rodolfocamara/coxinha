import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CalendarRange, Check, ChevronDown, Columns3, Rows3 } from 'lucide-react';
import { shortcutAria, shortcutHint, useEscapeLayer } from '../../lib/shortcuts';
import { DAY_COUNTS, type CalendarView } from './calendarViews';

/**
 * Outlook's switcher (spec 0104 P4): "Dia" with a 1–7 day menu, then work
 * week, week and month, one pressed at a time.
 */
export function ViewSwitcher({
  view,
  days,
  onChange,
}: {
  view: CalendarView;
  days: number;
  onChange: (view: CalendarView, days: number) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendar.${key}`, options);
  const views: {
    id: Exclude<CalendarView, 'day'>;
    icon: typeof Rows3;
    shortcut?: 'calendar.week' | 'calendar.month';
  }[] = [
    { id: 'workweek', icon: Columns3 },
    { id: 'week', icon: CalendarRange, shortcut: 'calendar.week' },
    { id: 'month', icon: CalendarDays, shortcut: 'calendar.month' },
  ];
  return (
    <div className="mh-cal-switch" role="group" aria-label={k('label')}>
      <span className="mh-cal-split">
        <button
          type="button"
          className="mh-cal-opt"
          aria-pressed={view === 'day'}
          aria-keyshortcuts={shortcutAria('calendar.day')}
          title={`${k('day')} · ${shortcutHint('calendar.day')}`}
          onClick={() => onChange('day', days)}
        >
          <Rows3 size={14} aria-hidden="true" />
          <span className="ch-bar-label">{k('day')}</span>
        </button>
        <DayMenu days={days} onPick={(count) => onChange('day', count)} />
      </span>
      {views.map(({ id, icon: Icon, shortcut }) => (
        <button
          key={id}
          type="button"
          className="mh-cal-opt"
          aria-pressed={view === id}
          aria-keyshortcuts={shortcut && shortcutAria(shortcut)}
          title={shortcut ? `${k(id)} · ${shortcutHint(shortcut)}` : k(id)}
          onClick={() => onChange(id, days)}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="ch-bar-label">{k(id)}</span>
        </button>
      ))}
    </div>
  );
}

function DayMenu({ days, onPick }: { days: number; onPick: (count: number) => void }) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendar.${key}`, options);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
  ];

  useEffect(() => {
    if (!open) return;
    items()[days - 1]?.focus();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
    // Focus lands on the checked count only when the menu opens.
  }, [open]);

  const dismiss = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEscapeLayer(open, dismiss);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mh-cal-opt mh-cal-caret"
        aria-label={k('dayCount')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          className="mh-cal-menu"
          role="menu"
          aria-label={k('dayCount')}
          onKeyDown={onKeyDown}
        >
          {DAY_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              role="menuitemradio"
              aria-checked={count === days}
              tabIndex={-1}
              className="mh-cal-menu-item"
              onClick={() => {
                onPick(count);
                dismiss();
              }}
            >
              {k('days', { count })}
              {count === days && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
