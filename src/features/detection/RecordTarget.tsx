import { useEscapeLayer } from '../../lib/shortcuts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Mic } from 'lucide-react';
import type { CalendarEvent } from '../agenda/calendar';

/**
 * "Gravar ▾" with the meeting it records into beside it (spec 0113): the arrow
 * lists the calendar meetings around now and "Gravar sem reunião".
 */
export function RecordTarget({
  events,
  target,
  onTarget,
  onRecord,
  busy,
  disabled,
}: {
  events: CalendarEvent[];
  /** null records alone, without a calendar meeting. */
  target: CalendarEvent | null;
  onTarget: (event: CalendarEvent | null) => void;
  onRecord: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const when = (e: CalendarEvent) =>
    `${time.format(new Date(e.startsAt))}–${time.format(new Date(e.endsAt))}`;
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
  ];

  useEffect(() => {
    if (!open) return;
    (items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const close = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!menu.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (event: CalendarEvent | null) => {
    onTarget(event);
    setOpen(false);
    trigger.current?.focus();
  };
  useEscapeLayer(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Tab') setOpen(false);
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  };
  const option = (event: CalendarEvent | null, label: string, meta?: string) => (
    <button
      key={event?.id ?? 'solo'}
      type="button"
      role="menuitemradio"
      aria-checked={(target?.id ?? null) === (event?.id ?? null)}
      tabIndex={-1}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary focus:bg-secondary focus:outline-none"
      onClick={() => pick(event)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {meta && <span className="block text-xs text-muted-foreground tabular-nums">{meta}</span>}
      </span>
      {(target?.id ?? null) === (event?.id ?? null) && <Check size={14} aria-hidden="true" />}
    </button>
  );

  return (
    <span className="relative inline-flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0">
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-l-md bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={disabled}
          onClick={onRecord}
        >
          <Mic size={13} aria-hidden="true" />
          {t(busy ? 'recorder.starting' : 'recorder.record')}
        </button>
        <button
          ref={trigger}
          type="button"
          className="inline-flex h-6 items-center rounded-r-md border-l border-primary-foreground/25 bg-primary px-1 text-primary-foreground disabled:opacity-50"
          aria-label={t('recorder.target.choose')}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </span>
      <span className="cx-strip-muted min-w-0 truncate" data-testid="record-target">
        {target ? `${target.title} · ${when(target)}` : t('recorder.target.solo')}
      </span>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={t('recorder.target.choose')}
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 rounded-md border border-border bg-card p-1 shadow-lg"
          onKeyDown={onKeyDown}
        >
          {events.map((event) => option(event, event.title, when(event)))}
          {events.length > 0 && <div className="my-1 h-px bg-border" role="separator" />}
          {option(null, t('recorder.target.solo'), t('recorder.target.soloHelp'))}
        </div>
      )}
    </span>
  );
}
