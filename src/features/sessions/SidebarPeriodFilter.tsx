import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { PeriodSelector } from './PeriodSelector';
import { useSessionNavigation } from './sessionNavigation';

export function SidebarPeriodFilter() {
  const { t } = useTranslation();
  const period = useSessionNavigation((state) => state.sidebarPeriod);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const active = period.kind !== 'all';
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function focusLeft(next: EventTarget | null) {
    if (next instanceof Element && next.closest('[data-select-popup]')) return;
    if (
      !(next instanceof Node) ||
      (!popup.current?.contains(next) && !trigger.current?.contains(next))
    )
      close();
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 300));
      setPosition({
        top,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
        maxHeight: Math.max(80, window.innerHeight - top - 8),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLElement>('[role=combobox]')?.focus();
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Element && event.target.closest('[data-select-popup]')) return;
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[data-select-popup]')) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="session-header-icon relative"
        aria-label={t(active ? 'sessionSidebar.activeFilter' : 'sessionSidebar.filter')}
        title={t(active ? 'sessionSidebar.activeFilter' : 'sessionSidebar.filter')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onBlur={(event) => focusLeft(event.relatedTarget)}
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        {active && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1 rounded-full bg-primary"
          />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="dialog"
            tabIndex={-1}
            aria-label={t('sessionCalendar.sidebarPeriod')}
            className="session-period-popup"
            style={position}
            onBlur={(event) => focusLeft(event.relatedTarget)}
          >
            <PeriodSelector
              compact
              label={t('sessionCalendar.sidebarPeriod')}
              period={period}
              onChange={(sidebarPeriod) => useSessionNavigation.setState({ sidebarPeriod })}
            />
            {active && (
              <p className="px-2 mt-2 text-xs text-muted-foreground">
                {t('sessionCalendar.sidebarUndatedHelp')}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
